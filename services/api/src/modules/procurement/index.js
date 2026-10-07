import { createHash } from "node:crypto";

import { add, allocate, decimal, format, mul } from "./money.js";

// Procurement's small configuration records: purchasing categories, policies
// and source rules (and the outbox for reading). Purchase orders, goods
// receipts, purchase returns and supplier bills live in ./purchase-orders;
// suppliers in ./suppliers.
export class ProcurementError extends Error {
  constructor(status, message, code = "PROCUREMENT_ERROR") {
    super(message);
    this.name = "ProcurementError";
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTERNAL_INPUT_FIELDS = new Set(["status", "createdAt", "createdBy", "updatedAt", "updatedBy", "version", "contentHash", "expectedVersion", "action", "idempotencyKey"]);

const RESOURCE_CONFIG = Object.freeze({
  categories: { table: "procurement_categories", kind: "document", view: "procurement.view", manage: "procurement.settings.manage" },
  policies: { table: "procurement_policies", kind: "child", view: "procurement.view", manage: "procurement.settings.manage" },
  "source-rules": { table: "procurement_source_rules", kind: "child", view: "procurement.view", manage: "procurement.settings.manage" },
  outbox: { table: "procurement_outbox", kind: "outbox", view: "procurement.audit.view", manage: null },
});

function permission(context, key) {
  if (!key || (context.roleSlugs || []).some((value) => ["organization_owner", "system_administrator"].includes(value))) return;
  if (!(context.permissions || []).includes(key)) throw new ProcurementError(403, "You do not have permission to perform this action.", "PROCUREMENT_FORBIDDEN");
}
function id(value, label = "Record") {
  if (!UUID.test(String(value || ""))) throw new ProcurementError(400, `${label} is invalid.`, "PROCUREMENT_INVALID_ID");
  return String(value);
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function text(value, label, { required = false, max = 5000 } = {}) {
  const normalized = value === undefined || value === null ? "" : String(value).trim();
  if (required && !normalized) throw new ProcurementError(400, `${label} is required.`, "PROCUREMENT_VALIDATION");
  if (normalized.length > max) throw new ProcurementError(400, `${label} is too long.`, "PROCUREMENT_VALIDATION");
  return normalized || null;
}
function configFor(resource) {
  const config = RESOURCE_CONFIG[resource];
  if (!config) throw new ProcurementError(404, "Unknown Procurement resource.", "PROCUREMENT_RESOURCE_NOT_FOUND");
  return config;
}
function payloadOf(resource, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ProcurementError(400, "Payload must be an object.", "PROCUREMENT_VALIDATION");
  const value = Object.fromEntries(Object.entries(input).filter(([key]) => !INTERNAL_INPUT_FIELDS.has(key)));
  if (resource === "categories") {
    value.name = text(value.name || value.title, "Category name", { required: true, max: 160 });
    value.code = text(value.code, "Category code", { required: true, max: 60 }).toUpperCase();
  }
  return value;
}

export function contentHash(value) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function procurementContext(session) {
  return { organizationId: session.organizationId, userId: session.userId, permissions: session.permissions || [], roleSlugs: session.roleSlugs || [] };
}

async function event(client, context, recordId, resource, eventType, payload = {}) {
  await client.query(`INSERT INTO tenant.procurement_events (organization_id, entity_type, entity_id, event_type, payload, actor_user_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [context.organizationId, resource, recordId, eventType, JSON.stringify(payload), context.userId]);
}

export async function listProcurementRecords(client, context, resource, filters = {}) {
  const config = configFor(resource);
  permission(context, config.view);
  const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 200);
  const offset = Math.max(Number(filters.offset || 0), 0);
  const values = [context.organizationId];
  let where = "organization_id=$1";
  if (filters.status) { values.push(String(filters.status)); where += ` AND status=$${values.length}`; }
  if (filters.search) {
    values.push(`%${String(filters.search).trim()}%`);
    where += config.kind === "document" ? ` AND search_text ILIKE $${values.length}` : ` AND data::text ILIKE $${values.length}`;
  }
  const total = Number((await client.query(`SELECT count(*)::int AS total FROM tenant.${config.table} WHERE ${where}`, values)).rows[0]?.total || 0);
  const { rows } = await client.query(`SELECT * FROM tenant.${config.table} WHERE ${where} ORDER BY ${config.kind === "outbox" ? "created_at" : "updated_at"} DESC, id DESC LIMIT ${limit} OFFSET ${offset}`, values);
  return { rows: rows.map((row) => ({ ...(row.data || {}), ...row })), total, limit, offset };
}

export async function getProcurementRecord(client, context, resource, recordId) {
  const config = configFor(resource);
  permission(context, config.view);
  const row = (await client.query(`SELECT * FROM tenant.${config.table} WHERE organization_id=$1 AND id=$2`, [context.organizationId, id(recordId)])).rows[0];
  if (!row) throw new ProcurementError(404, "Procurement record not found.", "PROCUREMENT_RECORD_NOT_FOUND");
  return { ...(row.data || {}), ...row };
}

export async function createProcurementRecord(client, context, resource, input) {
  const config = configFor(resource);
  if (!config.manage) throw new ProcurementError(405, "This Procurement resource is read-only.");
  permission(context, config.manage);
  const payload = payloadOf(resource, input);
  const idempotencyKey = text(input?.idempotencyKey, "Idempotency key", { max: 200 });
  const row = config.kind === "document"
    ? (await client.query(
      `INSERT INTO tenant.${config.table} (organization_id, status, search_text, data, content_hash, created_by, updated_by, idempotency_key)
       VALUES ($1, 'active', $2, $3::jsonb, $4, $5, $5, $6) ON CONFLICT DO NOTHING RETURNING *`,
      [context.organizationId, [payload.code, payload.name].filter(Boolean).join(" "), JSON.stringify(payload), contentHash(payload), context.userId, idempotencyKey])).rows[0]
    : (await client.query(
      `INSERT INTO tenant.${config.table} (organization_id, status, data, content_hash, updated_by, idempotency_key) VALUES ($1, 'active', $2::jsonb, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING *`,
      [context.organizationId, JSON.stringify(payload), contentHash(payload), context.userId, idempotencyKey])).rows[0];
  if (!row) {
    if (!idempotencyKey) throw new ProcurementError(409, "The Procurement record could not be created.", "PROCUREMENT_DUPLICATE");
    const existing = (await client.query(`SELECT * FROM tenant.${config.table} WHERE organization_id=$1 AND idempotency_key=$2`, [context.organizationId, idempotencyKey])).rows[0];
    if (existing) return { ...(existing.data || {}), ...existing };
    throw new ProcurementError(409, "A record with this code already exists.", "PROCUREMENT_DUPLICATE");
  }
  await event(client, context, row.id, resource, "created", { contentHash: row.content_hash });
  return { ...(row.data || {}), ...row };
}

export async function updateProcurementRecord(client, context, resource, recordId, input) {
  const config = configFor(resource);
  if (!config.manage) throw new ProcurementError(405, "This Procurement resource is read-only.");
  permission(context, config.manage);
  const current = await getProcurementRecord(client, context, resource, recordId);
  const expected = Number(input?.expectedVersion);
  if (!Number.isInteger(expected) || expected !== Number(current.version || 1))
    throw new ProcurementError(409, "This record changed after it was loaded. Refresh and try again.", "PROCUREMENT_VERSION_CONFLICT");
  const payload = payloadOf(resource, { ...(current.data || {}), ...input });
  const status = ["active", "inactive"].includes(input?.status) ? input.status : current.status;
  const row = (await client.query(
    `UPDATE tenant.${config.table} SET status=$3, data=$4::jsonb, content_hash=$5, version=version+1, updated_by=$6, updated_at=now()
       ${config.kind === "document" ? ", search_text=$8" : ""}
      WHERE organization_id=$1 AND id=$2 AND version=$7 RETURNING *`,
    [context.organizationId, current.id, status, JSON.stringify(payload), contentHash(payload), context.userId, expected,
      ...(config.kind === "document" ? [[payload.code, payload.name].filter(Boolean).join(" ")] : [])])).rows[0];
  if (!row) throw new ProcurementError(409, "This record changed before the update was applied.", "PROCUREMENT_VERSION_CONFLICT");
  await event(client, context, row.id, resource, "updated", { version: row.version });
  return { ...(row.data || {}), ...row };
}

export { add, allocate, decimal, format, mul };
