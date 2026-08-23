import { redactAuditPayload } from "@/shared/security/redaction";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { PoolClient } from "pg";

import { query } from "@/core/db";
import { HttpError } from "@/core/http";

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const CAPTURE_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

function safeHexEqual(left: string, right: string) {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

// Shared trusted-proxy fingerprint verification for every public,
// unauthenticated CRM lead-capture entry point (see docs/implementation/
// ERP_SECURITY_HARDENING_003.md, Part 3). A caller MAY present an
// HMAC-signed x-vercentlabs-capture-* header set proving a trusted delivery
// proxy relayed the request; when absent, callers fall back to
// clientIp()+user-agent (never a raw, client-suppliable header) for a
// same-request-computed fingerprint. Both public capture routes must use
// this one implementation rather than trusting X-Forwarded-For directly.
export function verifiedCaptureProxyFingerprint(request: Request, rawBody: string) {
  const timestamp = request.headers.get("x-vercentlabs-capture-timestamp") || "";
  const fingerprint = request.headers.get("x-vercentlabs-capture-fingerprint") || "";
  const signature = request.headers.get("x-vercentlabs-capture-signature") || "";
  if (!timestamp && !fingerprint && !signature) return null;

  const secret = process.env.CRM_CAPTURE_PROXY_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new HttpError(503, "Trusted lead delivery is not configured.");
  }
  if (!/^\d{13}$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(fingerprint)) {
    throw new HttpError(401, "Invalid trusted lead-delivery signature.");
  }
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > CAPTURE_SIGNATURE_MAX_AGE_MS) {
    throw new HttpError(401, "Trusted lead-delivery signature expired.");
  }
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${fingerprint}.${rawBody}`)
    .digest("hex");
  if (!safeHexEqual(signature, expected)) {
    throw new HttpError(401, "Invalid trusted lead-delivery signature.");
  }
  return `proxy:${fingerprint}`;
}

// Fallback fingerprint for a direct (non-proxied) public submission. Uses
// clientIp() — which only trusts an operator-configured header, never a
// raw client-suppliable one — rather than reading X-Forwarded-For
// unconditionally.
export function directCaptureFingerprint(request: Request) {
  return sha256(`${clientIp(request)}|${request.headers.get("user-agent") || "unknown"}`);
}

function configuredOrigins() {
  return new Set(
    (
      process.env.FORM_ALLOWED_ORIGINS ||
      process.env.APP_URL ||
      "http://localhost:3001"
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => new URL(value).origin),
  );
}

function requestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") {
    try {
      return new URL(origin).origin;
    } catch {
      throw new HttpError(403, "The request origin is not allowed.");
    }
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      throw new HttpError(403, "The request origin is not allowed.");
    }
  }

  return null;
}

export function clientIp(request: Request) {
  const configuredHeader =
    process.env.TRUSTED_PROXY_IP_HEADER?.trim().toLowerCase();

  if (!configuredHeader) {
    return process.env.NODE_ENV === "production" ? "unavailable" : "local";
  }

  const rawValue = request.headers.get(configuredHeader);
  if (!rawValue) return "unavailable";

  const index = Math.max(
    0,
    Number.parseInt(process.env.TRUSTED_PROXY_CLIENT_INDEX || "0", 10) || 0,
  );
  const candidate = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)[index];

  return candidate && isIP(candidate) ? candidate : "unavailable";
}

export function assertSameOrigin(request: Request) {
  const origin = requestOrigin(request);
  if (!origin || !configuredOrigins().has(origin)) {
    throw new HttpError(403, "The request origin is not allowed.");
  }
}

export function assertSameOriginOrMobile(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const mobileClient = request.headers.get("x-vercentlabs-client") || "";
  if (
    /^Bearer [A-Za-z0-9_-]{40,200}$/.test(authorization) &&
    /^mobile\/[A-Za-z0-9._-]+$/.test(mobileClient)
  ) {
    return;
  }
  assertSameOrigin(request);
}

export async function readRequestBytes(request: Request, maximumBytes: number) {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader) {
    const length = Number(lengthHeader);
    if (!Number.isFinite(length) || length < 0 || length > maximumBytes) {
      throw new HttpError(413, "The request is too large.");
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, "The request is too large.");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
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
  client?: PoolClient;
}) {
  const statement = `
    INSERT INTO audit_events (
      id, organization_id, actor_user_id, event_type, entity_type, entity_id,
      metadata, before_data, after_data, ip_address, user_agent
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)
  `;
  const values = [
      randomUUID(),
      input.organizationId || null,
      input.actorUserId || null,
      input.eventType,
      input.entityType,
      input.entityId || null,
      JSON.stringify(redactAuditPayload(input.metadata || {})),
      input.beforeData === undefined ? null : JSON.stringify(redactAuditPayload(input.beforeData)),
      input.afterData === undefined ? null : JSON.stringify(redactAuditPayload(input.afterData)),
      input.request ? clientIp(input.request) : null,
      input.request?.headers.get("user-agent")?.slice(0, 500) || null,
    ];
  if (input.client) {
    await input.client.query(statement, values);
  } else {
    await query(statement, values);
  }
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
