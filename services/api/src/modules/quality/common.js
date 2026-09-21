// Shared helpers for the Quality domain modules (inspections, nonconformance/CAPA, management). The
// pre-existing `index.js` of this folder is the original thin module and is left untouched, except
// that its well-built, already race-safe `releaseQualityHold` (idempotent, optimistically versioned,
// partial-release aware, and the exact function Stock's own movement gate depends on) is reused as-is
// rather than reimplemented -- see nonconformance.js.
export class QualityError extends Error {
  constructor(status, message, code = "QUALITY_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new QualityError(400, `${label} is invalid.`, "QUALITY_REFERENCE_INVALID");
  return String(value);
};
export const uuidOrNull = (value, label) => (value === undefined || value === null || value === "" ? null : uuid(value, label));
export const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
export const textOrNull = (value, max = 500) => {
  const t = text(value, max);
  return t || null;
};
// Only the organization owner bypasses a permission check.
export const has = (c, p) => c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(p);
export const hasAny = (c, list) => list.some((p) => has(c, p));
export const need = (c, p) => {
  if (!has(c, p)) throw new QualityError(403, "You do not have permission to perform this quality operation.", "QUALITY_FORBIDDEN");
};
export const needAny = (c, list) => {
  if (!hasAny(c, list)) throw new QualityError(403, "You do not have permission to perform this quality operation.", "QUALITY_FORBIDDEN");
};
export const positive = (value, label) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new QualityError(400, `${label} must be greater than zero.`, "QUALITY_NUMBER_INVALID");
  return n;
};
export const nonNegative = (value, label, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new QualityError(400, `${label} must be zero or greater.`, "QUALITY_NUMBER_INVALID");
  return n;
};
export const dateOrNull = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new QualityError(400, `${label} is not a valid date.`, "QUALITY_DATE_INVALID");
  return s;
};
export const dateRequired = (value, label) => {
  const d = dateOrNull(value, label);
  if (!d) throw new QualityError(400, `${label} is required.`, "QUALITY_DATE_REQUIRED");
  return d;
};
export const oneOf = (value, allowed, label) => {
  if (!allowed.includes(value)) throw new QualityError(400, `${label} must be one of: ${allowed.join(", ")}.`, "QUALITY_VALUE_INVALID");
  return value;
};
export const today = () => new Date().toISOString().slice(0, 10);
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function qualityContext(session) {
  const companyId = session.activeCompanyId || session.companyId;
  if (!companyId) throw new QualityError(400, "Select an active company before using Quality.", "ACTIVE_COMPANY_REQUIRED");
  return { organizationId: session.organizationId, companyId, userId: session.userId, permissions: session.permissions || [], roleSlugs: session.roleSlugs || [] };
}

export async function recordEvent(client, c, aggregateType, aggregateId, eventType, payload = {}) {
  await client.query(
    `INSERT INTO tenant.quality_events(organization_id,company_id,aggregate_type,aggregate_id,event_type,payload,actor_user_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [c.organizationId, c.companyId, aggregateType, aggregateId, eventType, JSON.stringify(payload), c.userId],
  );
}

// pg returns a DATE column as a local-midnight JS Date, which then serialises a day early in any zone
// east of UTC. Every Quality read goes through qx(), which turns DATE columns (type 1082) into their
// plain 'YYYY-MM-DD' text; timestamps stay Dates.
export const ymd = (v) => (v instanceof Date ? `${String(v.getFullYear()).padStart(4, "0")}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v);
export async function qx(client, sql, params) {
  const res = await client.query(sql, params);
  const cols = (res.fields ?? []).filter((f) => f.dataTypeID === 1082).map((f) => f.name);
  if (cols.length) for (const row of res.rows) for (const k of cols) if (row[k] instanceof Date) row[k] = ymd(row[k]);
  return res;
}

// Run thunks one after another on the single tenant connection (pg queues concurrent queries and
// warns; sequential is explicit).
export async function seq(thunks) {
  const out = [];
  for (const t of thunks) out.push(await t());
  return out;
}
