// Projects — what is derived, never typed: progress from the tracked work, an explainable health with its reasons, and the linked records as their own modules hold them (number, status and — for those allowed —
// amounts). Everything is rebuilt from its sources on each read.
import { ACTIVE_STATUSES, eligibleUsers, has, isoDay, projectSettings, today } from "./project-core.js";
import { percentText, taskPercent } from "./progress/progress-rules.js";

// ------------------------------------------------------------------ the work a project tracks
// Tasks and Milestones are their own features. Each registers a source here that fills, per project, { total, completed, open, overdue,
// overdueCritical, openRequired } for tasks and milestones; until one is installed a project has no progress data (never a made-up 100%).
const WORK_SOURCES = [];
export function registerProjectWorkSource(source) {
  if (typeof source === "function" && !WORK_SOURCES.includes(source)) WORK_SOURCES.push(source);
}
export async function workSummaries(client, c, projectIds) {
  const map = new Map(projectIds.map((id) => [id, { tasks: null, milestones: null }]));
  for (const source of WORK_SOURCES) await source(client, c, projectIds, map);
  return map;
}
export function progressOf(work) {
  const tasks = work?.tasks;
  if (!tasks || !tasks.total) return { state: "NO_DATA", percent: null, label: tasks ? "Not started — no tasks yet" : "No progress data", tasks: tasks ?? null, milestones: work?.milestones ?? null };
  // Progress Tracking's one formula (done over all but the cancelled, one decimal, never rounded up).
  const percent = taskPercent(tasks.completed, tasks.total);
  return { state: "TRACKED", percent, label: `${percentText(percent)} task completion`, tasks, milestones: work?.milestones ?? null };
}

// ------------------------------------------------------------------ health
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
// { state: ON_TRACK | AT_RISK | BLOCKED | UNKNOWN | COMPLETED | CANCELLED, label, reasons[], note } — a warning with its reasons, not a forecast.
export function healthOf(project, { day, dueSoonDays, managerActive = true, hold = null, work = null }) {
  const target = project.target_end_date ? isoDay(project.target_end_date) : null;
  const note = project.health_note ? { text: project.health_note, at: project.health_noted_at } : null;
  if (project.status === "COMPLETED") {
    const done = isoDay(project.completed_at);
    return { state: "COMPLETED", label: "Completed", final: true, note: null, codes: [],
      reasons: [target && done > target ? `Completed ${daysBetween(target, done)} day(s) after the target date` : `Completed${target ? " on or before the target date" : ""}`] };
  }
  if (project.status === "CANCELLED") return { state: "CANCELLED", label: "Cancelled", final: true, reasons: [project.cancel_reason ?? "Cancelled"], codes: [], note: null };
  if (project.status === "ON_HOLD") return { state: "BLOCKED", label: "Blocked", reasons: [`On hold${hold?.reason ? `: ${hold.reason}` : ""}`], codes: ["ON_HOLD"], note };
  if (project.status === "DRAFT") return { state: "UNKNOWN", label: "Not active yet", reasons: ["The project is still a draft."], codes: ["DRAFT"], note: null };
  // Each warning carries a code (Progress Tracking stores the codes with its snapshots) and its plain-language reason.
  const reasons = [];
  const codes = [];
  const warn = (code, reason) => { codes.push(code); reasons.push(reason); };
  if (!managerActive) warn("MANAGER_INACTIVE", "The Project Manager is no longer an active, authorized member — assign a replacement.");
  if (project.risk_flagged) warn("RISK_FLAGGED", `Delivery risk flagged: ${project.risk_note ?? "see the project"}`);
  if (target) {
    const left = daysBetween(day, target);
    if (left < 0) warn("TARGET_PASSED", `The target date passed ${-left} day(s) ago.`);
    else if (left <= dueSoonDays && (!work?.tasks || !work.tasks.total || work.tasks.open > 0)) warn("TARGET_NEAR", `The target date is in ${left} day(s)${work?.tasks?.total ? ` with ${work.tasks.open} task(s) open` : ""}.`);
  }
  if (project.status === "PLANNED" && project.planned_start_date && isoDay(project.planned_start_date) < day) warn("START_MISSED", "The planned start date passed and the project has not started.");
  if (work?.tasks?.overdueCritical) warn("CRITICAL_TASKS_OVERDUE", `${work.tasks.overdueCritical} critical task(s) overdue.`);
  if (work?.tasks?.blockedCritical) warn("CRITICAL_TASKS_BLOCKED", `${work.tasks.blockedCritical} high-priority or urgent task(s) blocked.`);
  if (work?.milestones?.overdue) warn("MILESTONES_OVERDUE", `${work.milestones.overdue} required milestone(s) overdue.`);
  if (work?.milestones?.awaitingNearDue) warn("ACCEPTANCE_PENDING_NEAR_DUE", `${work.milestones.awaitingNearDue} required milestone(s) still await approval or customer acceptance close to their due date.`);
  if (reasons.length) return { state: "AT_RISK", label: "At risk", reasons, codes, note };
  if (!target) return { state: "UNKNOWN", label: "Unknown", reasons: ["No target date to measure against."], codes: ["NO_TARGET"], note };
  return { state: "ON_TRACK", label: "On track", reasons: ["No warning conditions."], codes: [], note };
}
// The facts health needs for many projects at once.
export async function healthContext(client, c, projects) {
  const settings = await projectSettings(client, c);
  const day = await today(client);
  const managers = await eligibleUsers(client, c, projects.map((row) => row.manager_user_id));
  const ids = projects.map((row) => row.id);
  // An active hold's reason is its open blockers (resolved ones no longer hold it).
  const holds = ids.length ? new Map((await client.query(`SELECT hold.project_id, COALESCE((SELECT string_agg(reason.description, '; ' ORDER BY reason.added_at) FROM tenant.project_hold_reasons reason
      WHERE reason.hold_id = hold.id AND reason.resolved_at IS NULL), hold.reason) AS reason, hold.owner_user_id, hold.started_at
     FROM tenant.project_holds hold WHERE hold.organization_id = $1 AND hold.project_id = ANY($2::uuid[]) AND hold.resolved_at IS NULL`,
    [c.organizationId, ids])).rows.map((row) => [row.project_id, row])) : new Map();
  const work = await workSummaries(client, c, ids);
  return { settings, day, managers, holds, work,
    of: (project) => healthOf(project, { day, dueSoonDays: settings.dueSoonDays, managerActive: !project.manager_user_id || managers.has(project.manager_user_id),
      hold: holds.get(project.id) ?? null, work: work.get(project.id) }) };
}

// ------------------------------------------------------------------ linked records, as their modules hold them
const SOURCE_SQL = Object.freeze({
  CRM_ACCOUNT: { sql: `SELECT id, COALESCE(customer_number, code) AS number, display_name AS title, status, NULL::numeric AS amount, NULL::numeric AS outstanding FROM tenant.business_parties WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    href: (id) => `/crm/accounts/${id}`, label: "CRM account", permission: "crm.accounts.view" },
  CRM_CONTACT: { sql: `SELECT id, contact_number AS number, COALESCE(NULLIF(display_name, ''), btrim(concat_ws(' ', first_name, last_name))) AS title, status, NULL::numeric AS amount, NULL::numeric AS outstanding
      FROM tenant.contacts WHERE organization_id = $1 AND id = ANY($2::uuid[])`, href: (id) => `/crm/contacts/${id}`, label: "Contact", permission: "crm.contacts.view" },
  CRM_OPPORTUNITY: { sql: `SELECT id, code AS number, name AS title, status, amount, NULL::numeric AS outstanding FROM tenant.crm_opportunities WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    href: (id) => `/crm/opportunities/${id}`, label: "Opportunity", permission: "crm.opportunities.view" },
  SALES_QUOTATION: { sql: `SELECT quotation.id, quotation.quotation_number AS number, NULL AS title, quotation.lifecycle_status AS status, version.grand_total AS amount, NULL::numeric AS outstanding
      FROM tenant.sales_quotations quotation LEFT JOIN tenant.sales_quotation_versions version ON version.id = quotation.current_version_id WHERE quotation.organization_id = $1 AND quotation.id = ANY($2::uuid[])`,
    href: (id) => `/sales/quotations/${id}`, label: "Quotation", permission: "sales.quotation.view" },
  SALES_ORDER: { sql: `SELECT sales_order.id, sales_order.sales_order_number AS number, NULL AS title, sales_order.lifecycle_status AS status, sales_order.billing_status, sales_order.payment_status,
        version.grand_total AS amount, NULL::numeric AS outstanding FROM tenant.sales_orders sales_order LEFT JOIN tenant.sales_order_versions version ON version.id = sales_order.current_version_id
      WHERE sales_order.organization_id = $1 AND sales_order.id = ANY($2::uuid[])`, href: (id) => `/sales/orders/${id}`, label: "Sales order", permission: "sales.order.view" },
  SALES_INVOICE: { sql: `SELECT id, invoice_number AS number, NULL AS title, status, grand_total AS amount, outstanding_amount AS outstanding FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    href: (id) => `/sales/invoices/${id}`, label: "Invoice", permission: "sales.invoice.view" },
  PURCHASE_ORDER: { sql: `SELECT id, purchase_order_number AS number, NULL AS title, status, grand_total AS amount, NULL::numeric AS outstanding FROM tenant.purchase_orders WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    href: (id) => `/procurement/purchase-orders/${id}`, label: "Purchase order", permission: "procurement.po.view" },
  SUPPLIER_BILL: { sql: `SELECT id, bill_number AS number, supplier_invoice_number AS title, status, grand_total AS amount, outstanding_amount AS outstanding FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    href: (id) => `/procurement/supplier-bills/${id}`, label: "Supplier bill", permission: "procurement.bills.view" },
});
export const LINK_LABEL = Object.freeze(Object.fromEntries(Object.entries(SOURCE_SQL).map(([key, value]) => [key, value.label])));
const money = (value) => (value === null || value === undefined ? null : Number(value).toFixed(2));
// The project's active links with each record's number and status (amounts only for those who see project financials and the source).
export async function resolvedLinks(client, c, projectId, { financials = false } = {}) {
  const links = (await client.query(`SELECT * FROM tenant.project_links WHERE organization_id = $1 AND project_id = $2 AND removed_at IS NULL ORDER BY created_at`, [c.organizationId, projectId])).rows;
  const byType = new Map();
  for (const link of links) byType.set(link.source_type, [...(byType.get(link.source_type) ?? []), link.source_id]);
  const records = new Map();
  for (const [type, ids] of byType) {
    for (const row of (await client.query(SOURCE_SQL[type].sql, [c.organizationId, ids])).rows) records.set(`${type}:${row.id}`, row);
  }
  return links.map((link) => {
    const source = SOURCE_SQL[link.source_type];
    const record = records.get(`${link.source_type}:${link.source_id}`);
    const allowed = has(c, source.permission);
    return {
      id: link.id, sourceModule: link.source_module, sourceType: link.source_type, typeLabel: source.label, sourceId: link.source_id, sourceLineId: link.source_line_id, linkType: link.link_type,
      note: link.note, createdAt: link.created_at, createdBy: link.created_by,
      record: !record ? { missing: true } : !allowed ? { restricted: true } : {
        number: record.number, title: record.title, status: record.status, billingStatus: record.billing_status ?? null, paymentStatus: record.payment_status ?? null,
        amount: financials ? money(record.amount) : null, outstanding: financials ? money(record.outstanding) : null, href: source.href(link.source_id),
      },
      raw: record ?? null,
    };
  });
}

export { ACTIVE_STATUSES };
