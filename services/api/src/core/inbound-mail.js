// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
// core/shared-platform.ts (inbound-mail slice). Security properties
// preserved: HMAC-SHA256 webhook signature with timing-safe compare;
// idempotent recording keyed on (organization,provider,provider_message_id)
// with payload-digest divergence detection, so a replay with different
// content is rejected rather than silently accepted as the same event.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const PLATFORM_INBOUND_MAIL_IDEMPOTENCY_CONFLICT = "PLATFORM_INBOUND_MAIL_IDEMPOTENCY_CONFLICT";

export class InboundMailError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "InboundMailError";
    this.status = status;
    this.code = code;
  }
}

function text(value, name, maximum = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new InboundMailError(400, `${name} is required.`);
  if (normalized.length > maximum) throw new InboundMailError(400, `${name} is too long.`);
  return normalized;
}

function optionalText(value, maximum = 2_000) {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > maximum) throw new InboundMailError(400, "The submitted text is too long.");
  return normalized;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function inboundMailSecret(env) {
  const secret = String(env.INBOUND_MAIL_WEBHOOK_SECRET || "").trim();
  if (secret.length < 32) {
    throw new InboundMailError(503, "Inbound mail webhook signing is not configured.", "PLATFORM_INBOUND_MAIL_NOT_CONFIGURED");
  }
  return secret;
}

export function verifyInboundMailSignature(rawBody, signatureValue, env = process.env) {
  const supplied = String(signatureValue || "").trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-f]{64}$/i.test(supplied)) {
    throw new InboundMailError(401, "Inbound mail signature is invalid.", "PLATFORM_INBOUND_MAIL_SIGNATURE_INVALID");
  }
  const expected = createHmac("sha256", inboundMailSecret(env)).update(rawBody).digest();
  const actual = Buffer.from(supplied, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new InboundMailError(401, "Inbound mail signature is invalid.", "PLATFORM_INBOUND_MAIL_SIGNATURE_INVALID");
  }
}

export async function recordInboundMailEvent(client, input) {
  const provider = text(input.provider, "Inbound mail provider", 80);
  const providerMessageId = text(input.providerMessageId, "Provider message id", 240);
  const routeKey = text(input.routeKey, "Inbound route key", 160);
  if (!/^[0-9a-f]{64}$/i.test(input.payloadDigest)) throw new InboundMailError(400, "Inbound payload digest is invalid.");
  const inserted = await client.query(
    `INSERT INTO inbound_mail_events(
       organization_id,provider,provider_message_id,route_key,sender_hash,subject,payload_digest
     ) VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (organization_id,provider,provider_message_id) DO NOTHING
     RETURNING id`,
    [
      input.organizationId,
      provider,
      providerMessageId,
      routeKey,
      input.sender ? hash(String(input.sender).trim().toLowerCase()) : null,
      optionalText(input.subject, 500),
      input.payloadDigest.toLowerCase(),
    ],
  );
  if (inserted.rows[0]) return { id: inserted.rows[0].id, replayed: false };
  const existing = await client.query(
    `SELECT id,payload_digest FROM inbound_mail_events
      WHERE organization_id=$1 AND provider=$2 AND provider_message_id=$3`,
    [input.organizationId, provider, providerMessageId],
  );
  if (!existing.rows[0]) {
    throw new InboundMailError(409, "Inbound mail idempotency replay could not be resolved.", "PLATFORM_INBOUND_MAIL_REPLAY_MISSING");
  }
  if (String(existing.rows[0].payload_digest).toLowerCase() !== input.payloadDigest.toLowerCase()) {
    throw new InboundMailError(409, "The provider message id was reused with different inbound-mail content.", PLATFORM_INBOUND_MAIL_IDEMPOTENCY_CONFLICT);
  }
  return { id: existing.rows[0].id, replayed: true };
}
