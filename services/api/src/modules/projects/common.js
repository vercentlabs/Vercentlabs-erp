// Shared helpers for the Projects desk domain modules (setup, planning, time, finance, control, reports).
// The pre-existing `index.js` of this folder is the original thin module and is left untouched.
import { createHash } from "node:crypto";

export class ProjectError extends Error {
  constructor(status, message, code = "PROJECT_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new ProjectError(400, `${label} is invalid.`, "PROJECT_REFERENCE_INVALID");
  return String(value);
};
export const uuidOrNull = (value, label) => (value === undefined || value === null || value === "" ? null : uuid(value, label));
export const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
export const textOrNull = (value, max = 500) => text(value, max) || null;
export const requiredText = (value, label, max = 500) => {
  const t = text(value, max);
  if (!t) throw new ProjectError(400, `${label} is required.`, "PROJECT_FIELD_REQUIRED");
  return t;
};
export const has = (c, p) => c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(p);
export const hasAny = (c, list) => list.some((p) => has(c, p));
export const need = (c, p) => {
  if (!has(c, p)) throw new ProjectError(403, "You do not have permission to perform this project operation.", "PROJECT_FORBIDDEN");
};
export const needAny = (c, list) => {
  if (!hasAny(c, list)) throw new ProjectError(403, "You do not have permission to perform this project operation.", "PROJECT_FORBIDDEN");
};
export const oneOf = (value, allowed, label) => {
  if (!allowed.includes(value)) throw new ProjectError(400, `${label} must be one of: ${allowed.join(", ")}.`, "PROJECT_VALUE_INVALID");
  return value;
};
export const positive = (value, label) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ProjectError(400, `${label} must be greater than zero.`, "PROJECT_NUMBER_INVALID");
  return n;
};
export const nonNegative = (value, label, fallback = 0) => {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new ProjectError(400, `${label} must be zero or greater.`, "PROJECT_NUMBER_INVALID");
  return n;
};
export const dateOrNull = (value, label) => {
  if (value === undefined || value === null || value === "") return null;
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new ProjectError(400, `${label} is not a valid date.`, "PROJECT_DATE_INVALID");
  return s;
};
export const dateRequired = (value, label) => {
  const d = dateOrNull(value, label);
  if (!d) throw new ProjectError(400, `${label} is required.`, "PROJECT_DATE_REQUIRED");
  return d;
};
export const today = () => new Date().toISOString().slice(0, 10);
export const hashOf = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Money in integer minor units so cost, revenue, billing and variance never drift.
export const toCents = (value) => {
  if (value === null || value === undefined || value === "") return 0n;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
  if (!m) throw new ProjectError(400, "An amount is not a valid number.", "PROJECT_NUMBER_INVALID");
  const frac = (m[3] || "").padEnd(3, "0");
  const whole = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
  const rounded = frac[2] >= "5" ? whole + 1n : whole;
  return m[1] === "-" ? -rounded : rounded;
};
export const fromCents = (cents) => {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  return `${neg ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
};

// Date maths on ISO date strings (UTC, no time zone drift).
export const asDate = (s) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
export const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = asDate(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const diffDays = (a, b) => Math.round((asDate(b) - asDate(a)) / 86400000);
export const isWeekend = (s) => [0, 6].includes(asDate(s).getUTCDay());
export const mondayOf = (s) => { const d = asDate(s); const day = d.getUTCDay(); d.setUTCDate(d.getUTCDate() - ((day + 6) % 7)); return iso(d); };
// Add working days (Mon-Fri) to a date; 0 returns the date itself moved to the next working day.
export function addWorkingDays(start, days) {
  let d = start;
  while (isWeekend(d)) d = addDays(d, 1);
  let left = days;
  while (left > 0) { d = addDays(d, 1); if (!isWeekend(d)) left -= 1; }
  return d;
}
export function workingDaysBetween(from, to) {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (!isWeekend(d)) n += 1;
  return n;
}

export function projectsContext(session) {
  const companyId = session.activeCompanyId || session.companyId;
  if (!companyId) throw new ProjectError(400, "Select an active company before using Projects.", "ACTIVE_COMPANY_REQUIRED");
  return { organizationId: session.organizationId, companyId, userId: session.userId, permissions: session.permissions || [], roleSlugs: session.roleSlugs || [] };
}

export async function recordEvent(client, c, aggregateType, aggregateId, eventType, payload = {}) {
  await client.query(
    `INSERT INTO tenant.project_events(organization_id,company_id,aggregate_type,aggregate_id,event_type,payload,actor_user_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [c.organizationId, c.companyId, aggregateType, aggregateId, eventType, JSON.stringify(payload), c.userId],
  );
}

// pg returns a DATE column as a local-midnight JS Date, which serialises a day early east of UTC. Every
// read goes through qx(), which turns DATE columns (type 1082) into 'YYYY-MM-DD' text.
export const ymd = (v) => (v instanceof Date ? `${String(v.getFullYear()).padStart(4, "0")}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v);
export async function qx(client, sql, params) {
  const res = await client.query(sql, params);
  const cols = (res.fields ?? []).filter((f) => f.dataTypeID === 1082).map((f) => f.name);
  if (cols.length) for (const row of res.rows) for (const k of cols) if (row[k] instanceof Date) row[k] = ymd(row[k]);
  return res;
}

export async function nextNumber(client, c, documentType, prefix) {
  const { nextDocumentNumber } = await import("../../core/document-numbering.js");
  return nextDocumentNumber(client, c, { documentType, prefix });
}

// Team members (and anyone holding only projects.view / time.enter / expense.enter) see only the projects they
// belong to; every operational, financial or approval permission lifts that.
const BROAD = ["projects.manage", "projects.create", "projects.approve", "projects.tasks.manage", "projects.milestones.manage", "projects.resources.manage", "projects.time.approve", "projects.expense.approve", "projects.budget.manage", "projects.procurement.link", "projects.billing.manage", "projects.profitability.view", "projects.reports.view", "projects.settings.manage", "projects.audit.view"];
export const isBroad = (c) => c.roleSlugs?.includes("organization_owner") || BROAD.some((p) => c.permissions?.includes(p));
const FINANCE = ["projects.budget.manage", "projects.billing.manage", "projects.profitability.view", "projects.approve", "projects.reports.view"];
export const canSeeFinance = (c) => c.roleSlugs?.includes("organization_owner") || FINANCE.some((p) => c.permissions?.includes(p));
export const canSeeRates = (c) => canSeeFinance(c) || has(c, "projects.resources.manage");

export async function loadSettings(client, c) {
  const res = await client.query(`SELECT * FROM tenant.project_settings WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId]);
  return res.rows[0] || { require_time_approval: true, require_expense_approval: true, prohibit_self_approval: true, default_currency_code: "INR", hours_per_day: 8, require_membership_for_time: true, require_baseline_approval: true, require_budget_approval: true, require_billing_approval: true, require_close_checks: true, default_billing_method: "non_billable" };
}

export async function isMember(client, c, projectId, userId = c.userId) {
  const r = await client.query(`SELECT 1 FROM tenant.project_members WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 AND active=true`, [c.organizationId, projectId, userId]);
  return Boolean(r.rows[0]);
}

// Loads a project the caller may see: company scope always, membership for narrow users.
export async function loadProject(client, c, projectId, { lock = false, write = false } = {}) {
  const res = await qx(client, `SELECT * FROM tenant.projects WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(projectId, "Project")]);
  const p = res.rows[0];
  if (!p) throw new ProjectError(404, "Project was not found.", "PROJECT_NOT_FOUND");
  if (!isBroad(c) && p.project_manager_id !== c.userId && !(await isMember(client, c, p.id))) throw new ProjectError(404, "Project was not found.", "PROJECT_NOT_FOUND");
  void write;
  return p;
}

// Operational change is refused once a project is closed out; a completed or cancelled project must be reopened.
export const assertOpen = (p, what = "change") => {
  if (["completed", "cancelled"].includes(p.status)) throw new ProjectError(409, `This project is ${p.status}; reopen it before you ${what}.`, "PROJECT_CLOSED");
};
