// Inbound email: route registry + verified, idempotent receipt.
//
// Provider contract (documented in SHARED_PLATFORM_ARCHITECTURE.md): the mail
// provider (or a small adapter in front of it) POSTs a normalised JSON message
// to /api/platform/mail/inbound/{routeKey} with
//   X-Inbound-Signature: sha256=<hex HMAC-SHA256(route signing secret, raw body)>
// The organisation, target and company come ONLY from the route; any
// organisation id in the body is ignored. A provider message id may be sent
// once: a replay with identical content is a no-op, with different content it
// is rejected.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { audit } from "../../../security.js";
import { decryptSecret, encryptSecret } from "../../secrets/index.js";

export const PLATFORM_INBOUND_MAIL_IDEMPOTENCY_CONFLICT = "PLATFORM_INBOUND_MAIL_IDEMPOTENCY_CONFLICT";
export const INBOUND_MAIL_TARGETS = Object.freeze([
  Object.freeze({ key: "support.email_to_ticket", moduleKey: "support", label: "Support: new emails open tickets, replies join them" }),
]);
const MAX_TEXT = 100_000;
const MAX_ATTACHMENTS = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InboundMailError extends Error {
  constructor(status, message, code = "PLATFORM_INBOUND_MAIL_ERROR") {
    super(message);
    this.name = "InboundMailError";
    this.status = status;
    this.code = code;
  }
}

const hash = (value) => createHash("sha256").update(value).digest("hex");

// ------------------------------------------------------------ administration

function routeDto(row) {
  return {
    id: row.id,
    name: row.name,
    target: row.target,
    targetLabel: INBOUND_MAIL_TARGETS.find((target) => target.key === row.target)?.label ?? row.target,
    companyId: row.company_id,
    companyName: row.company_name ?? null,
    recordedAsUserId: row.recorded_as_user_id,
    recordedAsName: row.recorded_as_name ?? null,
    routeKeyPrefix: row.route_key_prefix,
    status: row.status,
    createdAt: row.created_at,
    lastReceivedAt: row.last_received_at,
    receivedCount: row.received_count,
  };
}

export async function listInboundMailRoutes(client, organizationId) {
  const { rows } = await client.query(
    `SELECT route.*, company.name AS company_name, member.full_name AS recorded_as_name
       FROM inbound_mail_routes route
       LEFT JOIN companies company ON company.id = route.company_id
       LEFT JOIN users member ON member.id = route.recorded_as_user_id
      WHERE route.organization_id=$1 ORDER BY (route.status='active') DESC, route.created_at DESC`,
    [organizationId],
  );
  return rows.map(routeDto);
}

// Returns the route key and signing secret ONCE (only hashes/ciphertext kept).
export async function createInboundMailRoute(client, session, input, env = process.env) {
  const name = String(input?.name || "").trim().slice(0, 120);
  if (!name) throw new InboundMailError(400, "Name the inbound address.", "PLATFORM_INBOUND_MAIL_INPUT_INVALID");
  if (!INBOUND_MAIL_TARGETS.some((target) => target.key === input?.target)) throw new InboundMailError(400, "Choose what incoming mail should do.", "PLATFORM_INBOUND_MAIL_TARGET_UNKNOWN");
  if (!UUID.test(String(input?.companyId || ""))) throw new InboundMailError(400, "Choose the company.", "PLATFORM_INBOUND_MAIL_INPUT_INVALID");
  const company = (await client.query(`SELECT id FROM companies WHERE organization_id=$1 AND id=$2 AND status='active'`, [session.organizationId, input.companyId])).rows[0];
  if (!company) throw new InboundMailError(400, "Choose an active company.", "PLATFORM_INBOUND_MAIL_INPUT_INVALID");
  const recordedAs = UUID.test(String(input?.recordedAsUserId || "")) ? input.recordedAsUserId : session.userId;
  const member = (await client.query(`SELECT 1 FROM organization_memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'`, [session.organizationId, recordedAs])).rows[0];
  if (!member) throw new InboundMailError(400, "Mail must be recorded as an active member.", "PLATFORM_INBOUND_MAIL_INPUT_INVALID");
  const routeKey = `imr_${randomBytes(24).toString("base64url")}`;
  const signingSecret = `whsec_${randomBytes(32).toString("base64url")}`;
  const { rows } = await client.query(
    `INSERT INTO inbound_mail_routes (organization_id, name, route_key_hash, route_key_prefix, target, company_id, recorded_as_user_id, encrypted_signing_secret, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING *`,
    [session.organizationId, name, hash(routeKey), routeKey.slice(0, 12), input.target, input.companyId, recordedAs, JSON.stringify(await encryptSecret({ secret: signingSecret }, env)), session.userId],
  );
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "integration.inbound_route_created", entityType: "inbound_mail_route", entityId: rows[0].id, afterData: { name, target: input.target, companyId: input.companyId } });
  return { route: routeDto(rows[0]), routeKey, signingSecret };
}

export async function setInboundMailRouteStatus(client, session, routeId, status) {
  if (!["active", "disabled"].includes(status)) throw new InboundMailError(400, "Unsupported status.", "PLATFORM_INBOUND_MAIL_INPUT_INVALID");
  if (!UUID.test(String(routeId || ""))) throw new InboundMailError(404, "Inbound address not found.", "PLATFORM_INBOUND_MAIL_ROUTE_NOT_FOUND");
  const { rows } = await client.query(`UPDATE inbound_mail_routes SET status=$3, updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [session.organizationId, routeId, status]);
  if (!rows[0]) throw new InboundMailError(404, "Inbound address not found.", "PLATFORM_INBOUND_MAIL_ROUTE_NOT_FOUND");
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: status === "disabled" ? "integration.inbound_route_disabled" : "integration.inbound_route_enabled", entityType: "inbound_mail_route", entityId: rows[0].id });
  return routeDto(rows[0]);
}

export async function listInboundMailEvents(client, organizationId, { routeId = null, limit = 50 } = {}) {
  const { rows } = await client.query(
    `SELECT id, route_id, provider, subject, status, outcome, processing_error, ticket_id, received_at, processed_at, attachment_notes
       FROM inbound_mail_events WHERE organization_id=$1 AND ($2::uuid IS NULL OR route_id=$2::uuid)
      ORDER BY received_at DESC LIMIT $3`,
    [organizationId, routeId && UUID.test(routeId) ? routeId : null, Math.min(Math.max(Number(limit) || 50, 1), 200)],
  );
  return rows.map((row) => ({
    id: row.id,
    routeId: row.route_id,
    provider: row.provider,
    subject: row.subject,
    status: row.status,
    outcome: row.outcome,
    error: row.processing_error ? String(row.processing_error).slice(0, 300) : null,
    ticketId: row.ticket_id,
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    attachmentNotes: row.attachment_notes,
  }));
}

// ------------------------------------------------------------ receipt

/** Resolves a route key to its trusted configuration (platform transaction). */
export async function resolveInboundMailRoute(client, routeKey) {
  const key = String(routeKey || "");
  if (!/^imr_[A-Za-z0-9_-]{20,64}$/.test(key)) throw new InboundMailError(404, "Unknown inbound address.", "PLATFORM_INBOUND_MAIL_ROUTE_NOT_FOUND");
  const { rows } = await client.query(`SELECT * FROM inbound_mail_routes WHERE route_key_hash=$1 AND status='active'`, [hash(key)]);
  if (!rows[0]) throw new InboundMailError(404, "Unknown inbound address.", "PLATFORM_INBOUND_MAIL_ROUTE_NOT_FOUND");
  return rows[0];
}

export function verifyInboundMailSignature(rawBody, signatureValue, secret) {
  const supplied = String(signatureValue || "").trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-f]{64}$/i.test(supplied)) throw new InboundMailError(401, "Inbound mail signature is invalid.", "PLATFORM_INBOUND_MAIL_SIGNATURE_INVALID");
  const expected = createHmac("sha256", String(secret)).update(rawBody).digest();
  const actual = Buffer.from(supplied, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new InboundMailError(401, "Inbound mail signature is invalid.", "PLATFORM_INBOUND_MAIL_SIGNATURE_INVALID");
  }
}

export async function routeSigningSecret(route, env = process.env) {
  return (await decryptSecret(route.encrypted_signing_secret, env)).secret;
}

const text = (value, max) => (value === undefined || value === null ? null : String(value).slice(0, max));
const address = (value) => {
  const email = String(value?.email ?? value ?? "").trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) && email.length <= 320 ? email : null;
};
const messageId = (value) => {
  const id = String(value || "").trim().replace(/^<|>$/g, "");
  return id && id.length <= 300 && !/[\s<>]/.test(id) ? id : null;
};

/** Validates and normalises the provider's JSON (organisation fields ignored). */
export function normalizeInboundMessage(payload) {
  if (!payload || typeof payload !== "object") throw new InboundMailError(400, "The inbound message is malformed.", "PLATFORM_INBOUND_MAIL_MALFORMED");
  const provider = String(payload.provider || "").trim().toLowerCase().slice(0, 40);
  const id = messageId(payload.messageId);
  const from = address(payload.from);
  if (!provider || !/^[a-z0-9_-]+$/.test(provider) || !id || !from) throw new InboundMailError(400, "The inbound message needs a provider, a message id and a sender.", "PLATFORM_INBOUND_MAIL_MALFORMED");
  const references = [payload.inReplyTo, ...(Array.isArray(payload.references) ? payload.references : [])].map(messageId).filter(Boolean).slice(0, 20);
  const attachments = (Array.isArray(payload.attachments) ? payload.attachments : []).slice(0, MAX_ATTACHMENTS).map((attachment) => ({
    fileName: text(attachment?.fileName, 200) || "attachment",
    contentType: text(attachment?.contentType, 120) || "application/octet-stream",
    contentBase64: typeof attachment?.contentBase64 === "string" ? attachment.contentBase64 : "",
  }));
  return {
    provider,
    messageId: id,
    references,
    from,
    fromName: text(payload.from?.name ?? payload.fromName, 200),
    to: (Array.isArray(payload.to) ? payload.to : [payload.to]).map(address).filter(Boolean).slice(0, 20),
    subject: (text(payload.subject, 500) || "(no subject)").replace(/[\r\n]+/g, " "),
    text: text(payload.text, MAX_TEXT) || "",
    attachments,
  };
}

/**
 * Records receipt once per (organisation, provider, message id). Returns the
 * event and whether this delivery is a replay; a reused id with different
 * content is refused.
 */
export async function recordInboundMailEvent(client, { route, message, payloadDigest }) {
  const inserted = await client.query(
    `INSERT INTO inbound_mail_events (organization_id, provider, provider_message_id, route_key, route_id, sender_hash, subject, payload_digest)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (organization_id, provider, provider_message_id) DO NOTHING RETURNING *`,
    [route.organization_id, message.provider, message.messageId, route.route_key_prefix, route.id, hash(message.from), message.subject, payloadDigest],
  );
  await client.query(`UPDATE inbound_mail_routes SET last_received_at=now(), received_count=received_count+1 WHERE id=$1`, [route.id]);
  if (inserted.rows[0]) return { event: inserted.rows[0], replayed: false };
  const existing = (
    await client.query(`SELECT * FROM inbound_mail_events WHERE organization_id=$1 AND provider=$2 AND provider_message_id=$3`, [route.organization_id, message.provider, message.messageId])
  ).rows[0];
  if (!existing) throw new InboundMailError(409, "Inbound mail idempotency replay could not be resolved.", "PLATFORM_INBOUND_MAIL_REPLAY_MISSING");
  if (String(existing.payload_digest) !== payloadDigest) {
    throw new InboundMailError(409, "The provider message id was reused with different content.", PLATFORM_INBOUND_MAIL_IDEMPOTENCY_CONFLICT);
  }
  return { event: existing, replayed: true };
}

export async function completeInboundMailEvent(client, eventId, { status, outcome = null, error = null, ticketId = null, communicationId = null, attachmentNotes = [] }) {
  await client.query(
    `UPDATE inbound_mail_events SET status=$2, outcome=$3, processing_error=$4, ticket_id=$5, communication_id=$6, attachment_notes=$7::jsonb, processed_at=now() WHERE id=$1`,
    [eventId, status, outcome, error ? String(error).slice(0, 1000) : null, ticketId, communicationId, JSON.stringify(attachmentNotes)],
  );
}

export function inboundPayloadDigest(rawBody) {
  return hash(rawBody);
}
