import { createHash, randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { HttpError } from "@/lib/http";

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function clientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const configured = (
    process.env.FORM_ALLOWED_ORIGINS ||
    process.env.APP_URL ||
    "http://localhost:3001"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!configured.includes(origin))
    throw new HttpError(403, "The request origin is not allowed.");
}

export async function enforceRateLimit(
  key: string,
  maximum: number,
  windowSeconds: number,
) {
  const rows = await query<{ attempts: number }>(
    `
    INSERT INTO auth_rate_limits (key, window_started_at, attempts)
    VALUES ($1, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN auth_rate_limits.window_started_at < now() - ($2 * interval '1 second') THEN 1 ELSE auth_rate_limits.attempts + 1 END,
      window_started_at = CASE WHEN auth_rate_limits.window_started_at < now() - ($2 * interval '1 second') THEN now() ELSE auth_rate_limits.window_started_at END
    RETURNING attempts
  `,
    [key, windowSeconds],
  );
  if ((rows[0]?.attempts || 0) > maximum)
    throw new HttpError(429, "Too many attempts. Try again later.");
}

export async function audit(input: {
  organizationId?: string | null;
  actorUserId?: string | null;
  eventType: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  beforeData?: unknown;
  afterData?: unknown;
  request?: Request;
}) {
  await query(
    `
    INSERT INTO audit_events (
      id, organization_id, actor_user_id, event_type, entity_type, entity_id,
      metadata, before_data, after_data, ip_address, user_agent
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)
  `,
    [
      randomUUID(),
      input.organizationId || null,
      input.actorUserId || null,
      input.eventType,
      input.entityType,
      input.entityId || null,
      JSON.stringify(input.metadata || {}),
      input.beforeData === undefined ? null : JSON.stringify(input.beforeData),
      input.afterData === undefined ? null : JSON.stringify(input.afterData),
      input.request ? clientIp(input.request) : null,
      input.request?.headers.get("user-agent")?.slice(0, 500) || null,
    ],
  );
}

export async function recordLoginEvent(input: {
  request: Request;
  email: string;
  userId?: string | null;
  succeeded: boolean;
  reason?: string;
}) {
  await query(
    `
    INSERT INTO login_events (id, user_id, email, succeeded, reason, ip_address, user_agent)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `,
    [
      randomUUID(),
      input.userId || null,
      input.email,
      input.succeeded,
      input.reason || null,
      clientIp(input.request),
      input.request.headers.get("user-agent")?.slice(0, 500) || null,
    ],
  );
}
