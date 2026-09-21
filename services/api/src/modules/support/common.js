// Shared helpers for the Support / Customer Service domain modules (tickets, knowledge, portal,
// service). The pre-existing `index.js` of this folder is the original thin module and is left
// untouched; everything here is the full implementation.
export class SupportError extends Error {
  constructor(status, message, code = "SUPPORT_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new SupportError(400, `${label} is invalid.`, "SUPPORT_REFERENCE_INVALID");
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
  if (!has(c, p)) throw new SupportError(403, "You do not have permission to perform this support operation.", "SUPPORT_FORBIDDEN");
};
export const needAny = (c, list) => {
  if (!hasAny(c, list)) throw new SupportError(403, "You do not have permission to perform this support operation.", "SUPPORT_FORBIDDEN");
};
export const positive = (value, label) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new SupportError(400, `${label} must be greater than zero.`, "SUPPORT_NUMBER_INVALID");
  return n;
};
export const nonNegative = (value, label, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new SupportError(400, `${label} must be zero or greater.`, "SUPPORT_NUMBER_INVALID");
  return n;
};
export const dateOrNull = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new SupportError(400, `${label} is not a valid date.`, "SUPPORT_DATE_INVALID");
  return s;
};
export const dateRequired = (value, label) => {
  const d = dateOrNull(value, label);
  if (!d) throw new SupportError(400, `${label} is required.`, "SUPPORT_DATE_REQUIRED");
  return d;
};
export const oneOf = (value, allowed, label) => {
  if (!allowed.includes(value)) throw new SupportError(400, `${label} must be one of: ${allowed.join(", ")}.`, "SUPPORT_VALUE_INVALID");
  return value;
};
export const today = () => new Date().toISOString().slice(0, 10);
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const emailOrNull = (value, label = "Email") => {
  const e = text(value, 320).toLowerCase();
  if (!e) return null;
  if (!EMAIL.test(e)) throw new SupportError(400, `${label} is not a valid email.`, "SUPPORT_EMAIL_INVALID");
  return e;
};

export const PRIORITIES = ["low", "normal", "high", "urgent", "critical"];
export const CHANNELS = ["web", "email", "phone", "chat", "whatsapp", "social", "internal"];

export function supportContext(session) {
  const companyId = session.activeCompanyId || session.companyId;
  if (!companyId) throw new SupportError(400, "Select an active company before using Support.", "ACTIVE_COMPANY_REQUIRED");
  return { organizationId: session.organizationId, companyId, userId: session.userId, permissions: session.permissions || [], roleSlugs: session.roleSlugs || [] };
}

export async function recordEvent(client, c, ticketId, aggregateType, aggregateId, eventType, payload = {}) {
  await client.query(
    `INSERT INTO tenant.support_events(organization_id,company_id,ticket_id,aggregate_type,aggregate_id,event_type,payload,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [c.organizationId, c.companyId, ticketId || null, aggregateType, aggregateId, eventType, JSON.stringify(payload), c.userId],
  );
}

// The portal link for the signed-in user (customer self-service). Null when the user has no portal
// access -- an ordinary staff user with no support permission and no portal link can do nothing here.
export async function ownPortalAccess(client, c) {
  const { rows } = await qx(client, `SELECT * FROM tenant.support_portal_users WHERE organization_id=$1 AND user_id=$2 AND status='active'`, [c.organizationId, c.userId]);
  return rows[0] ?? null;
}
export async function requirePortalAccess(client, c) {
  const p = await ownPortalAccess(client, c);
  if (!p) throw new SupportError(403, "You do not have portal access. Ask support to invite you.", "SUPPORT_NO_PORTAL_ACCESS");
  return p;
}

export const canSeeSensitive = (c) => has(c, "support.sensitive.view");
// A private note or a private attachment is hidden from anyone without support.sensitive.view -- the
// author can always see their own.
export function stripPrivate(rows, c, list = true) {
  const arr = list ? rows : [rows];
  const visible = canSeeSensitive(c) ? arr : arr.filter((r) => !r.private_note || r.created_by === c.userId || r.uploaded_by === c.userId);
  return list ? visible : (visible[0] ?? null);
}

// pg returns a DATE column as a local-midnight JS Date, which then serialises a day early in any zone
// east of UTC. Every Support read goes through qx(), which turns DATE columns (type 1082) into their
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

// The party (customer) this caller may act as: a portal customer for their own party, or any staff
// member holding support.view for any party.
export async function resolveParty(client, c, partyId) {
  const { rows } = await qx(client, `SELECT * FROM tenant.business_parties WHERE organization_id=$1 AND id=$2`, [c.organizationId, uuid(partyId, "Customer")]);
  if (!rows[0]) throw new SupportError(404, "Customer was not found.", "SUPPORT_PARTY_NOT_FOUND");
  return rows[0];
}
