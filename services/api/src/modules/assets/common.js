// Shared helpers for the Assets desk domain modules (register, custody, value, maintenance, control,
// disposal, reports). The pre-existing `index.js` of this folder is the original thin module and is
// left untouched; the desk modules below carry the full lifecycle.
import { createHash } from "node:crypto";

export class AssetError extends Error {
  constructor(status, message, code = "ASSET_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new AssetError(400, `${label} is invalid.`, "ASSET_REFERENCE_INVALID");
  return String(value);
};
export const uuidOrNull = (value, label) => (value === undefined || value === null || value === "" ? null : uuid(value, label));
export const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
export const textOrNull = (value, max = 500) => text(value, max) || null;
export const requiredText = (value, label, max = 500) => {
  const t = text(value, max);
  if (!t) throw new AssetError(400, `${label} is required.`, "ASSET_FIELD_REQUIRED");
  return t;
};
export const has = (c, p) => c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(p);
export const need = (c, p) => {
  if (!has(c, p)) throw new AssetError(403, "You do not have permission to perform this asset operation.", "ASSET_FORBIDDEN");
};
export const oneOf = (value, allowed, label) => {
  if (!allowed.includes(value)) throw new AssetError(400, `${label} must be one of: ${allowed.join(", ")}.`, "ASSET_VALUE_INVALID");
  return value;
};
export const positive = (value, label) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new AssetError(400, `${label} must be greater than zero.`, "ASSET_NUMBER_INVALID");
  return n;
};
export const nonNegative = (value, label, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new AssetError(400, `${label} must be zero or greater.`, "ASSET_NUMBER_INVALID");
  return n;
};
export const dateOrNull = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new AssetError(400, `${label} is not a valid date.`, "ASSET_DATE_INVALID");
  return s;
};
export const dateRequired = (value, label) => {
  const d = dateOrNull(value, label);
  if (!d) throw new AssetError(400, `${label} is required.`, "ASSET_DATE_REQUIRED");
  return d;
};
export const today = () => new Date().toISOString().slice(0, 10);
export const hashOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Money is held as integer minor units (cents) so depreciation, true-ups and gain/loss never drift.
export const toCents = (value) => {
  if (value === null || value === undefined || value === "") return 0n;
  const s = String(value).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new AssetError(400, "An amount is not a valid number.", "ASSET_NUMBER_INVALID");
  const frac = (m[3] || "").padEnd(3, "0");
  const whole = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
  const rounded = frac[2] >= "5" ? whole + 1n : whole;
  return m[1] === "-" ? -rounded : rounded;
};
export const fromCents = (cents) => {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
};

export function assetsContext(session) {
  const companyId = session.activeCompanyId || session.companyId;
  if (!companyId) throw new AssetError(400, "Select an active company before using Assets.", "ACTIVE_COMPANY_REQUIRED");
  return { organizationId: session.organizationId, companyId, userId: session.userId, permissions: session.permissions || [], roleSlugs: session.roleSlugs || [] };
}

export async function recordAssetEvent(client, c, assetId, eventType, payload = {}) {
  await client.query(
    `INSERT INTO tenant.asset_events(organization_id,company_id,asset_id,event_type,payload,actor_user_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
    [c.organizationId, c.companyId, assetId, eventType, JSON.stringify(payload), c.userId],
  );
}

// pg returns a DATE column as a local-midnight JS Date, which serialises a day early in any zone east
// of UTC. Every read goes through qx(), which turns DATE columns (type 1082) into 'YYYY-MM-DD' text.
export const ymd = (v) => (v instanceof Date ? `${String(v.getFullYear()).padStart(4, "0")}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v);
export async function qx(client, sql, params) {
  const res = await client.query(sql, params);
  const cols = (res.fields ?? []).filter((f) => f.dataTypeID === 1082).map((f) => f.name);
  if (cols.length) for (const row of res.rows) for (const k of cols) if (row[k] instanceof Date) row[k] = ymd(row[k]);
  return res;
}

export async function nextNumber(client, c, documentType, prefix) {
  const { nextDocumentNumber } = await import("../../core/platform/numbering/index.js");
  return nextDocumentNumber(client, c, { documentType, prefix });
}

export async function loadAsset(client, c, assetId, { lock = false } = {}) {
  const res = await qx(client, `SELECT * FROM tenant.assets WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(assetId, "Asset")]);
  if (!res.rows[0]) throw new AssetError(404, "Asset was not found.", "ASSET_NOT_FOUND");
  return res.rows[0];
}

export async function loadSettings(client, c) {
  const res = await client.query(`SELECT * FROM tenant.asset_settings WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId]);
  return res.rows[0] || { require_capitalization_approval: true, require_disposal_approval: true, prohibit_self_approval: true, default_depreciation_method: "straight_line", post_to_accounting: true, require_transfer_approval: true, require_value_adjustment_approval: true, depreciation_convention: "full_month", warranty_alert_days: 30, maintenance_lead_days: 7, calibration_alert_days: 30 };
}
