// The organisation audit read model over the existing append-only
// audit_events table (written by core/security.js audit()). There is no
// second audit store and no API to edit or delete audit events.
//
// Always scoped to the caller's organisation; callers must hold audit.view.
// Pagination is keyset on (created_at, id), stable when timestamps collide.
import { redactAuditPayload } from "../../audit-redaction.js";

export class AuditQueryError extends Error {
  constructor(status, message, code = "AUDIT_QUERY_INVALID") {
    super(message);
    this.name = "AuditQueryError";
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-z0-9_.:-]{1,120}$/i;
const MAX_JSON_CHARS = 8_000;

export function encodeAuditCursor(row) {
  return Buffer.from(`${new Date(row.created_at).toISOString()}|${row.id}`, "utf8").toString("base64url");
}

export function decodeAuditCursor(cursor) {
  const [at, id] = Buffer.from(String(cursor), "base64url").toString("utf8").split("|");
  const date = new Date(at);
  if (Number.isNaN(date.getTime()) || !UUID.test(id || "")) throw new AuditQueryError(400, "The page cursor is invalid.");
  return { at: date.toISOString(), id };
}

function date(value, name) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new AuditQueryError(400, `${name} is not a valid date.`);
  return parsed.toISOString();
}

// Defensive second redaction on read + size caps: audit data is sensitive even
// though it was redacted when written.
export function safeAuditPayload(value) {
  if (value === null || value === undefined) return null;
  const redacted = redactAuditPayload(value);
  const text = JSON.stringify(redacted);
  if (text.length <= MAX_JSON_CHARS) return redacted;
  return { truncated: true, preview: `${text.slice(0, MAX_JSON_CHARS)}…` };
}

export async function queryAuditEvents(client, organizationId, filters = {}) {
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 50));
  const parameters = [organizationId];
  const add = (value) => {
    parameters.push(value);
    return `$${parameters.length}`;
  };
  const where = ["event.organization_id = $1"];
  if (filters.actorUserId) {
    if (!UUID.test(String(filters.actorUserId))) throw new AuditQueryError(400, "The actor filter is invalid.");
    where.push(`event.actor_user_id = ${add(filters.actorUserId)}`);
  }
  if (filters.area) {
    if (!TOKEN.test(filters.area)) throw new AuditQueryError(400, "The area filter is invalid.");
    where.push(`split_part(event.event_type, '.', 1) = ${add(filters.area)}`);
  }
  if (filters.eventType) {
    if (!TOKEN.test(filters.eventType)) throw new AuditQueryError(400, "The action filter is invalid.");
    where.push(`event.event_type = ${add(filters.eventType)}`);
  }
  if (filters.entityType) {
    if (!TOKEN.test(filters.entityType)) throw new AuditQueryError(400, "The record type filter is invalid.");
    where.push(`event.entity_type = ${add(filters.entityType)}`);
  }
  if (filters.entityId) {
    if (String(filters.entityId).length > 100) throw new AuditQueryError(400, "The record filter is invalid.");
    where.push(`event.entity_id = ${add(String(filters.entityId))}`);
  }
  const from = date(filters.from, "From");
  const to = date(filters.to, "To");
  if (from) where.push(`event.created_at >= ${add(from)}`);
  if (to) where.push(`event.created_at < ${add(to)}`);
  if (filters.cursor) {
    const cursor = decodeAuditCursor(filters.cursor);
    where.push(`(event.created_at, event.id) < (${add(cursor.at)}::timestamptz, ${add(cursor.id)}::uuid)`);
  }
  const result = await client.query(
    `SELECT event.id, event.event_type, event.entity_type, event.entity_id, event.actor_user_id, event.created_at,
            actor.full_name AS actor_name, actor.email AS actor_email
       FROM audit_events event
       LEFT JOIN users actor ON actor.id = event.actor_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY event.created_at DESC, event.id DESC
      LIMIT ${add(limit + 1)}`,
    parameters,
  );
  const rows = result.rows.slice(0, limit);
  return {
    events: rows.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name || row.actor_email || null,
      createdAt: row.created_at,
    })),
    nextCursor: result.rows.length > limit ? encodeAuditCursor(rows[rows.length - 1]) : null,
  };
}

export async function getAuditEvent(client, organizationId, eventId) {
  if (!UUID.test(String(eventId || ""))) throw new AuditQueryError(404, "Audit event not found.", "AUDIT_EVENT_NOT_FOUND");
  const row = (
    await client.query(
      `SELECT event.*, actor.full_name AS actor_name, actor.email AS actor_email
         FROM audit_events event LEFT JOIN users actor ON actor.id = event.actor_user_id
        WHERE event.organization_id = $1 AND event.id = $2`,
      [organizationId, eventId],
    )
  ).rows[0];
  if (!row) throw new AuditQueryError(404, "Audit event not found.", "AUDIT_EVENT_NOT_FOUND");
  return {
    id: row.id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name || row.actor_email || null,
    createdAt: row.created_at,
    metadata: safeAuditPayload(row.metadata),
    before: safeAuditPayload(row.before_data),
    after: safeAuditPayload(row.after_data),
    request: row.ip_address || row.user_agent ? { ipAddress: row.ip_address, userAgent: row.user_agent ? String(row.user_agent).slice(0, 300) : null } : null,
  };
}

// Distinct actors that appear in this organisation's audit, for the filter.
export async function listAuditActors(client, organizationId) {
  const result = await client.query(
    `SELECT DISTINCT ON (member.user_id) member.user_id AS id, users.full_name, users.email
       FROM organization_memberships member JOIN users ON users.id = member.user_id
      WHERE member.organization_id = $1
        AND EXISTS (SELECT 1 FROM audit_events event WHERE event.organization_id = $1 AND event.actor_user_id = member.user_id)
      ORDER BY member.user_id LIMIT 500`,
    [organizationId],
  );
  return result.rows.map((row) => ({ id: row.id, name: row.full_name || row.email })).sort((a, b) => a.name.localeCompare(b.name));
}
