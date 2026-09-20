// Shared helpers for the HR & Payroll domain modules (workforce, recruitment, time, leave,
// compensation, payroll, statutory, talent). The pre-existing `index.js` of this folder is the
// original thin module and is left untouched; everything here is the full implementation.
export class HrError extends Error {
  constructor(status, message, code = "HR_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new HrError(400, `${label} is invalid.`, "HR_REFERENCE_INVALID");
  return String(value);
};
export const uuidOrNull = (value, label) => (value === undefined || value === null || value === "" ? null : uuid(value, label));
export const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
export const textOrNull = (value, max = 500) => {
  const t = text(value, max);
  return t || null;
};
// Only the organization owner bypasses a permission check. A system administrator does NOT
// automatically hold business approval or payroll authority (HR permission matrix).
export const has = (c, p) => c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(p);
export const hasAny = (c, list) => list.some((p) => has(c, p));
export const need = (c, p) => {
  if (!has(c, p)) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
};
export const needAny = (c, list) => {
  if (!hasAny(c, list)) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
};
export const positive = (value, label) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new HrError(400, `${label} must be greater than zero.`, "HR_NUMBER_INVALID");
  return n;
};
export const nonNegative = (value, label, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new HrError(400, `${label} must be zero or greater.`, "HR_NUMBER_INVALID");
  return n;
};
export const dateOrNull = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new HrError(400, `${label} is not a valid date.`, "HR_DATE_INVALID");
  return s;
};
export const dateRequired = (value, label) => {
  const d = dateOrNull(value, label);
  if (!d) throw new HrError(400, `${label} is required.`, "HR_DATE_REQUIRED");
  return d;
};
export const oneOf = (value, allowed, label) => {
  if (!allowed.includes(value)) throw new HrError(400, `${label} must be one of: ${allowed.join(", ")}.`, "HR_VALUE_INVALID");
  return value;
};
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function hrContext(session) {
  const companyId = session.activeCompanyId || session.companyId;
  if (!companyId) throw new HrError(400, "Select an active company before using HR & Payroll.", "ACTIVE_COMPANY_REQUIRED");
  return { organizationId: session.organizationId, companyId, userId: session.userId, permissions: session.permissions || [], roleSlugs: session.roleSlugs || [] };
}

export async function recordEvent(client, c, aggregateType, aggregateId, eventType, payload = {}) {
  await client.query(
    `INSERT INTO tenant.hr_payroll_events(organization_id,company_id,aggregate_type,aggregate_id,event_type,payload,actor_user_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [c.organizationId, c.companyId, aggregateType, aggregateId, eventType, JSON.stringify(payload), c.userId],
  );
}

// The employee record linked to the signed-in user (employee self-service). Null when the user has
// no HR profile.
export async function ownEmployee(client, c) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND user_id=$3 AND status <> 'draft' LIMIT 1`, [c.organizationId, c.companyId, c.userId]);
  return rows[0] ?? null;
}
export async function requireOwnEmployee(client, c) {
  const e = await ownEmployee(client, c);
  if (!e) throw new HrError(404, "Your user is not linked to an employee record. Ask HR to link it.", "HR_NO_EMPLOYEE_PROFILE");
  return e;
}

export const canSeeSensitive = (c) => has(c, "hr_payroll.sensitive.view");
export const EMPLOYEE_SENSITIVE = ["personal_email", "personal_phone", "date_of_birth", "gender", "marital_status", "nationality", "address", "bank_details", "tax_identifiers", "statutory_identifiers", "emergency_contacts"];
export function stripSensitive(row, c, ownId) {
  if (!row || canSeeSensitive(c) || (ownId && row.id === ownId)) return row;
  const clone = { ...row };
  for (const f of EMPLOYEE_SENSITIVE) delete clone[f];
  return clone;
}

export const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export function cleanBank(input = {}) {
  const b = {
    account_holder: text(input.accountHolder ?? input.account_holder, 120),
    account_number: text(input.accountNumber ?? input.account_number, 24).replace(/\s/g, ""),
    ifsc: text(input.ifsc, 11).toUpperCase(),
    bank_name: text(input.bankName ?? input.bank_name, 120),
  };
  if (!b.account_number && !b.ifsc && !b.account_holder && !b.bank_name) return {};
  if (!/^\d{6,18}$/.test(b.account_number)) throw new HrError(400, "Bank account number must be 6 to 18 digits.", "HR_BANK_INVALID");
  if (!IFSC.test(b.ifsc)) throw new HrError(400, "IFSC must look like ABCD0123456.", "HR_BANK_INVALID");
  if (!b.account_holder) throw new HrError(400, "Account holder name is required.", "HR_BANK_INVALID");
  return b;
}
export function cleanTax(input = {}) {
  const pan = text(input.pan, 10).toUpperCase();
  if (pan && !PAN.test(pan)) throw new HrError(400, "PAN must look like ABCDE1234F.", "HR_PAN_INVALID");
  const aadhaar = text(input.aadhaar, 12).replace(/\s/g, "");
  if (aadhaar && !/^\d{12}$/.test(aadhaar)) throw new HrError(400, "Aadhaar must be 12 digits.", "HR_AADHAAR_INVALID");
  const out = {};
  if (pan) out.pan = pan;
  if (aadhaar) out.aadhaar = aadhaar;
  if (input.regime) out.regime = oneOf(String(input.regime), ["new", "old"], "Tax regime");
  return out;
}
export function cleanStatutory(input = {}) {
  const out = {};
  const uan = text(input.uan, 12).replace(/\s/g, "");
  if (uan) {
    if (!/^\d{12}$/.test(uan)) throw new HrError(400, "UAN must be 12 digits.", "HR_UAN_INVALID");
    out.uan = uan;
  }
  const pf = text(input.pfNumber ?? input.pf_number, 40);
  if (pf) out.pf_number = pf;
  const esic = text(input.esicNumber ?? input.esic_number, 17).replace(/\s/g, "");
  if (esic) {
    if (!/^\d{10,17}$/.test(esic)) throw new HrError(400, "ESIC number must be 10 to 17 digits.", "HR_ESIC_INVALID");
    out.esic_number = esic;
  }
  if (input.pfApplicable !== undefined || input.pf_applicable !== undefined) out.pf_applicable = (input.pfApplicable ?? input.pf_applicable) === true;
  if (input.esicApplicable !== undefined || input.esic_applicable !== undefined) out.esic_applicable = (input.esicApplicable ?? input.esic_applicable) === true;
  if (input.ptState || input.pt_state) out.pt_state = text(input.ptState ?? input.pt_state, 40);
  return out;
}

// pg returns a DATE column as a local-midnight JS Date, which then serialises a day early in any
// zone east of UTC. Every HR read goes through qx(), which turns DATE columns (type 1082) into their
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
