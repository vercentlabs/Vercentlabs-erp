// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
// core/security.ts. Origin/IP helpers are pure (no client param); audit,
// login-event recording and rate-limiting are client-injected, following
// this package's existing convention.
//
// Security properties preserved: origin/referer allow-list validation
// (never trusts a raw client-suppliable header without an
// operator-configured trusted-proxy header); timing-safe HMAC compare for
// the trusted lead-capture proxy fingerprint; a same-origin-or-mobile
// bypass gated on a Bearer-token shape AND a matching X-Vercentlabs-Client
// mobile header (not either alone).
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import { redactAuditPayload } from "./audit-redaction.js";

export class SecurityError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "SecurityError";
    this.status = status;
    this.code = code;
  }
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const CAPTURE_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

function safeHexEqual(left, right) {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function verifiedCaptureProxyFingerprint(request, rawBody, env = process.env) {
  const timestamp = request.headers.get("x-vercentlabs-capture-timestamp") || "";
  const fingerprint = request.headers.get("x-vercentlabs-capture-fingerprint") || "";
  const signature = request.headers.get("x-vercentlabs-capture-signature") || "";
  if (!timestamp && !fingerprint && !signature) return null;

  const secret = env.CRM_CAPTURE_PROXY_SECRET?.trim();
  if (!secret || secret.length < 32) throw new SecurityError(503, "Trusted lead delivery is not configured.");
  if (!/^\d{13}$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(fingerprint)) {
    throw new SecurityError(401, "Invalid trusted lead-delivery signature.");
  }
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > CAPTURE_SIGNATURE_MAX_AGE_MS) {
    throw new SecurityError(401, "Trusted lead-delivery signature expired.");
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${fingerprint}.${rawBody}`).digest("hex");
  if (!safeHexEqual(signature, expected)) throw new SecurityError(401, "Invalid trusted lead-delivery signature.");
  return `proxy:${fingerprint}`;
}

export function directCaptureFingerprint(request, env = process.env) {
  return sha256(`${clientIp(request, env)}|${request.headers.get("user-agent") || "unknown"}`);
}

export function canonicalAppOrigin(env = process.env) {
  const raw = String(env.APP_URL || "http://localhost:3001").trim();
  try {
    const url = new URL(raw);
    if (env.NODE_ENV === "production" && url.protocol !== "https:") {
      throw new Error("APP_URL must use HTTPS in production.");
    }
    return url.origin;
  } catch {
    throw new SecurityError(503, "The application origin is not configured correctly.", "APP_ORIGIN_INVALID");
  }
}

function configuredOrigins(env) {
  return new Set(
    (env.FORM_ALLOWED_ORIGINS || env.APP_URL || "http://localhost:3001")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => new URL(value).origin),
  );
}

function requestOrigin(request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") {
    try {
      return new URL(origin).origin;
    } catch {
      throw new SecurityError(403, "The request origin is not allowed.");
    }
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      throw new SecurityError(403, "The request origin is not allowed.");
    }
  }
  return null;
}

export function clientIp(request, env = process.env) {
  const configuredHeader = env.TRUSTED_PROXY_IP_HEADER?.trim().toLowerCase();
  if (!configuredHeader) return env.NODE_ENV === "production" ? "unavailable" : "local";

  const rawValue = request.headers.get(configuredHeader);
  if (!rawValue) return "unavailable";

  // A negative index counts from the right: behind the Google Cloud load
  // balancer X-Forwarded-For is "<client-supplied...>, <client-ip>, <lb-ip>",
  // so -2 is the address the load balancer itself observed (unspoofable).
  const index = Number.parseInt(env.TRUSTED_PROXY_CLIENT_INDEX || "0", 10) || 0;
  const hops = rawValue.split(",").map((value) => value.trim()).filter(Boolean);
  const candidate = index < 0 ? hops[hops.length + index] : hops[index];
  return candidate && isIP(candidate) ? candidate : "unavailable";
}

export function assertSameOrigin(request, env = process.env) {
  const origin = requestOrigin(request);
  if (!origin || !configuredOrigins(env).has(origin)) {
    throw new SecurityError(403, "The request origin is not allowed.");
  }
}

export function assertSameOriginOrMobile(request, env = process.env) {
  const authorization = request.headers.get("authorization") || "";
  const mobileClient = request.headers.get("x-vercentlabs-client") || "";
  if (/^Bearer [A-Za-z0-9_-]{40,200}$/.test(authorization) && /^mobile\/[A-Za-z0-9._-]+$/.test(mobileClient)) {
    return;
  }
  assertSameOrigin(request, env);
}

export async function readRequestBytes(request, maximumBytes) {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader) {
    const length = Number(lengthHeader);
    if (!Number.isFinite(length) || length < 0 || length > maximumBytes) {
      throw new SecurityError(413, "The request is too large.");
    }
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new SecurityError(413, "The request is too large.");
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

export async function enforceRateLimit(client, key, maximum, windowSeconds) {
  const result = await client.query(
    `INSERT INTO auth_rate_limits (key, window_started_at, attempts)
     VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       attempts = CASE WHEN auth_rate_limits.window_started_at < now() - ($2 * interval '1 second') THEN 1 ELSE auth_rate_limits.attempts + 1 END,
       window_started_at = CASE WHEN auth_rate_limits.window_started_at < now() - ($2 * interval '1 second') THEN now() ELSE auth_rate_limits.window_started_at END
     RETURNING attempts`,
    [key, windowSeconds],
  );
  if ((result.rows[0]?.attempts || 0) > maximum) {
    throw new SecurityError(429, "Too many attempts. Try again later.");
  }
}

export async function audit(client, input) {
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
    input.request ? clientIp(input.request, input.env) : null,
    input.request?.headers.get("user-agent")?.slice(0, 500) || null,
  ];
  await client.query(statement, values);
}

export async function recordLoginEvent(client, input) {
  await client.query(
    `INSERT INTO login_events (id, user_id, email, succeeded, reason, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      randomUUID(),
      input.userId || null,
      input.email,
      input.succeeded,
      input.reason || null,
      clientIp(input.request, input.env),
      input.request.headers.get("user-agent")?.slice(0, 500) || null,
    ],
  );
}
