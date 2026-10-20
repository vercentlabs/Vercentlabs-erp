// GST — shared pieces of the return working papers: permissions, errors, money in paise (whole numbers, so sums never drift), the company
// GST registration a return is for, and the month it covers.
import { gstStateCode } from "../../core/tax/constants.js";

export class GstError extends Error {
  constructor(status, message, code = "GST_ERROR", details = undefined) {
    super(message);
    this.name = "GstError";
    this.status = status;
    this.statusCode = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
export const GST_PERMISSIONS = Object.freeze({
  view: "gst.view", prepare: "gst.return.prepare", approve: "gst.return.approve", file: "gst.return.file", itc: "gst.itc.manage",
});
export const can = (c, p) => Boolean(c?.roleSlugs?.includes("organization_owner") || c?.permissions?.includes(p));
export function need(c, p, message = "You do not have permission to do this.") {
  if (!can(c, p)) throw new GstError(403, message, "GST_FORBIDDEN");
}
export const RETURN_TYPES = Object.freeze({ GSTR1: "GSTR-1", GSTR3B: "GSTR-3B" });

// money as paise
export const paise = (v) => Math.round(Number(v ?? 0) * 100);
export const rupees = (p) => Math.round(p) / 100;
export const HEADS = ["igst", "cgst", "sgst", "utgst", "cess"];
export const zero = () => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, utgst: 0, cess: 0 });
export function addInto(target, source, sign = 1) {
  for (const k of ["taxable", ...HEADS]) target[k] = (target[k] ?? 0) + sign * (source[k] ?? 0);
  return target;
}
export const asRupees = (t) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, typeof v === "number" ? rupees(v) : v]));

// "2026-09" or "2026-09-15" → the month's first and last day
export function monthOf(value) {
  const m = /^(\d{4})-(\d{2})/.exec(String(value ?? ""));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new GstError(400, "Choose the return month (YYYY-MM).", "GST_PERIOD_INVALID");
  const start = `${m[1]}-${m[2]}-01`;
  const end = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).toISOString().slice(0, 10);
  return { start, end, month: `${m[1]}-${m[2]}` };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(value, label) {
  if (!UUID.test(String(value ?? ""))) throw new GstError(400, `${label} is not valid.`, "GST_INVALID");
  return String(value);
}
export const text = (v, max = 500) => String(v ?? "").trim().slice(0, max);
export const ymd = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : d ? String(d).slice(0, 10) : null);

// A place of supply as stored on documents ("27", "27-Maharashtra", "Maharashtra") → the two-digit state code.
export function stateCodeOf(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const m = /^(\d{2})\b/.exec(s);
  if (m) return m[1];
  return gstStateCode(s.replace(/^\d+\s*[-–]\s*/, "")) ?? null;
}

// The company registrations (GSTINs) a return can be for; the default one when no id is given.
export async function registrationOf(client, c, id) {
  const { rows } = id
    ? await client.query(`SELECT * FROM tenant.tax_registrations WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(id, "GST registration")])
    : await client.query(`SELECT * FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' ORDER BY is_default DESC, created_at LIMIT 1`, [c.organizationId]);
  const r = rows[0];
  if (!r) throw new GstError(404, "Add the company's GST registration (Settings › Taxes) first.", "GST_REGISTRATION_MISSING");
  if (!r.registration_number) throw new GstError(409, `The registration ${r.name} has no GSTIN.`, "GST_REGISTRATION_MISSING");
  return r;
}
export async function defaultRegistrationId(client, c) {
  return (await client.query(`SELECT id FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' ORDER BY is_default DESC, created_at LIMIT 1`, [c.organizationId])).rows[0]?.id ?? null;
}
export async function listRegistrations(client, c) {
  need(c, GST_PERMISSIONS.view);
  return (await client.query(`SELECT id, name, registration_number AS gstin, state_code, registration_type, status, is_default, einvoice_applicable, einvoice_applicable_from
    FROM tenant.tax_registrations WHERE organization_id = $1 AND registration_number IS NOT NULL ORDER BY is_default DESC, name`, [c.organizationId])).rows;
}
