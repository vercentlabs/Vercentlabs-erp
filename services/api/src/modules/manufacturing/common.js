// Shared helpers for the Manufacturing domain modules (engineering, shop floor, planning, costing).
export class MfgError extends Error {
  constructor(status, message, code = "MFG_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new MfgError(400, `${label} is invalid.`, "MFG_REFERENCE_INVALID");
  return String(value);
};
export const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
export const has = (c, p) => c.roleSlugs?.includes("organization_owner") || c.roleSlugs?.includes("system_administrator") || c.permissions?.includes(p);
export const need = (c, p) => {
  if (!has(c, p)) throw new MfgError(403, "You do not have permission to perform this manufacturing operation.", "MFG_FORBIDDEN");
};
export const positive = (value, label) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new MfgError(400, `${label} must be greater than zero.`, "MFG_QUANTITY_INVALID");
  return n;
};
export const nonNegative = (value, label, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new MfgError(400, `${label} must be zero or greater.`, "MFG_QUANTITY_INVALID");
  return n;
};
export const dateOrNull = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(value)) || Number.isNaN(Date.parse(String(value)))) throw new MfgError(400, `${label} is not a valid date.`, "MFG_DATE_INVALID");
  return String(value).slice(0, 10);
};

export async function recordEvent(client, c, aggregateType, aggregateId, eventType, payload = {}) {
  await client.query(
    `INSERT INTO tenant.manufacturing_events(organization_id,company_id,aggregate_type,aggregate_id,event_type,payload,actor_user_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [c.organizationId, c.companyId, aggregateType, aggregateId, eventType, JSON.stringify(payload), c.userId],
  );
}
