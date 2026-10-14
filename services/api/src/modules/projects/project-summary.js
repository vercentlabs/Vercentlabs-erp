// Projects — what is derived, never typed: progress from the tracked work, an explainable health with its reasons, the completion checklist,
// the dependency review before cancelling, and the linked records as their own modules hold them (number, status and — for those allowed —
// amounts). Everything is rebuilt from its sources on each read.
import { ACTIVE_STATUSES, STATUS_LABEL, eligibleUsers, has, isoDay, projectSettings, today } from "./project-core.js";

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
  const percent = Math.floor((tasks.completed / tasks.total) * 100);
  return { state: "TRACKED", percent, label: `${percent}% of tasks complete`, tasks, milestones: work?.milestones ?? null };
}

// ------------------------------------------------------------------ health
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
// { state: ON_TRACK | AT_RISK | BLOCKED | UNKNOWN | COMPLETED | CANCELLED, label, reasons[], note } — a warning with its reasons, not a forecast.
export function healthOf(project, { day, dueSoonDays, managerActive = true, hold = null, work = null }) {
  const target = project.target_end_date ? isoDay(project.target_end_date) : null;
  const note = project.health_note ? { text: project.health_note, at: project.health_noted_at } : null;
  if (project.status === "COMPLETED") {
    const done = isoDay(project.completed_at);
    return { state: "COMPLETED", label: "Completed", final: true, note: null,
      reasons: [target && done > target ? `Completed ${daysBetween(target, done)} day(s) after the target date` : `Completed${target ? " on or before the target date" : ""}`] };
  }
  if (project.status === "CANCELLED") return { state: "CANCELLED", label: "Cancelled", final: true, reasons: [project.cancel_reason ?? "Cancelled"], note: null };
  if (project.status === "ON_HOLD") return { state: "BLOCKED", label: "Blocked", reasons: [`On hold${hold?.reason ? `: ${hold.reason}` : ""}`], note };
  if (project.status === "DRAFT") return { state: "UNKNOWN", label: "Not active yet", reasons: ["The project is still a draft."], note: null };
  const reasons = [];
  if (!managerActive) reasons.push("The Project Manager is no longer an active, authorized member — assign a replacement.");
  if (project.risk_flagged) reasons.push(`Delivery risk flagged: ${project.risk_note ?? "see the project"}`);
  if (target) {
    const left = daysBetween(day, target);
    if (left < 0) reasons.push(`The target date passed ${-left} day(s) ago.`);
    else if (left <= dueSoonDays && (!work?.tasks || work.tasks.open > 0)) reasons.push(`The target date is in ${left} day(s)${work?.tasks ? ` with ${work.tasks.open} task(s) open` : ""}.`);
  }
  if (project.status === "PLANNED" && project.planned_start_date && isoDay(project.planned_start_date) < day) reasons.push("The planned start date passed and the project has not started.");
  if (work?.tasks?.overdueCritical) reasons.push(`${work.tasks.overdueCritical} critical task(s) overdue.`);
  if (work?.milestones?.overdue) reasons.push(`${work.milestones.overdue} required milestone(s) overdue.`);
  if (reasons.length) return { state: "AT_RISK", label: "At risk", reasons, note };
  if (!target) return { state: "UNKNOWN", label: "Unknown", reasons: ["No target date to measure against."], note };
  return { state: "ON_TRACK", label: "On track", reasons: ["No warning conditions."], note };
}
// The facts health needs for many projects at once.
export async function healthContext(client, c, projects) {
  const settings = await projectSettings(client, c);
  const day = await today(client);
  const managers = await eligibleUsers(client, c, projects.map((row) => row.manager_user_id));
  const ids = projects.map((row) => row.id);
  const holds = ids.length ? new Map((await client.query(`SELECT project_id, reason, owner_user_id, started_at FROM tenant.project_holds WHERE organization_id = $1 AND project_id = ANY($2::uuid[]) AND resolved_at IS NULL`,
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

// ------------------------------------------------------------------ completion and cancellation checks
const OPEN_PO = (status) => !["closed", "cancelled"].includes(String(status ?? "").toLowerCase());
// Each check: { key, label, state: PASS | FAIL | WARN | NOT_TRACKED | TO_CONFIRM, message, blocking }. In a preview (no input) what the person
// confirms at completion is TO_CONFIRM; at completion it must be given.
export async function completionCheck(client, c, project, input = {}, { preview = false } = {}) {
  const settings = await projectSettings(client, c);
  const day = await today(client);
  const work = (await workSummaries(client, c, [project.id])).get(project.id);
  const links = await resolvedLinks(client, c, project.id, { financials: true });
  const checks = [];
  const add = (key, label, state, message, blocking = state === "FAIL") => checks.push({ key, label, state, message, blocking });
  add("status", "In progress", project.status === "IN_PROGRESS" ? "PASS" : "FAIL", project.status === "IN_PROGRESS" ? "The project is in progress." : `The project is ${STATUS_LABEL[project.status].toLowerCase()}.`);
  if (!work.tasks) add("tasks", "Required tasks", "NOT_TRACKED", "Tasks are not tracked for projects yet.");
  else add("tasks", "Required tasks", work.tasks.openRequired ? "FAIL" : "PASS", work.tasks.openRequired ? `${work.tasks.openRequired} required task(s) are still open.` : "Every required task is done.");
  if (!work.milestones) add("milestones", "Required milestones", "NOT_TRACKED", "Milestones are not tracked for projects yet.");
  else add("milestones", "Required milestones", work.milestones.openRequired ? "FAIL" : "PASS", work.milestones.openRequired ? `${work.milestones.openRequired} required milestone(s) are still open.` : "Every required milestone is done.");
  add("blockers", "Open blockers", project.risk_flagged ? "FAIL" : "PASS", project.risk_flagged ? `A delivery risk is flagged: ${project.risk_note ?? ""} Clear it first.` : "No blocker is open.");
  add("time", "Time entries and expenses", "NOT_TRACKED", "Time and expenses are not tracked for projects yet.");
  const openPurchases = links.filter((link) => link.sourceType === "PURCHASE_ORDER" && link.raw && OPEN_PO(link.raw.status));
  add("procurement", "Project purchasing", openPurchases.length ? "WARN" : "PASS", openPurchases.length ? `Open purchase order(s): ${openPurchases.map((link) => link.raw.number).join(", ")}. Procurement keeps them; completing the project does not close them.` : "No open project purchase orders.", false);
  const unbilled = links.filter((link) => (link.sourceType === "SALES_ORDER" && link.raw && !["fully_invoiced", "not_billable"].includes(link.raw.billing_status))
    || (link.sourceType === "SALES_INVOICE" && link.raw && Number(link.raw.outstanding ?? 0) > 0));
  // Delivery is not held back by collection: outstanding billing is acknowledged, never required to be paid.
  if (unbilled.length) {
    const acknowledged = Boolean(input.acknowledgeOutstanding);
    add("financial", "Billing and collection", acknowledged ? "PASS" : preview ? "TO_CONFIRM" : "FAIL",
      `${unbilled.map((link) => `${link.raw.number} (${link.sourceType === "SALES_ORDER" ? String(link.raw.billing_status).replace(/_/g, " ") : "outstanding"})`).join(", ")} — acknowledge that billing or collection continues after completion.`, !preview && !acknowledged);
  } else add("financial", "Billing and collection", "PASS", "Nothing outstanding on the linked sales records.");
  const confirm = (key, labelText, given, message) => add(key, labelText, given ? "PASS" : preview ? "TO_CONFIRM" : "FAIL", message, !preview && !given);
  confirm("deliverables", "Deliverables confirmed", Boolean(input.deliverablesConfirmed), "Confirm the project's deliverables were delivered.");
  if (settings.customerAcceptanceRequired && project.classification === "CUSTOMER") {
    confirm("acceptance", "Customer acceptance", String(input.customerAcceptance ?? "").trim().length >= 3, "Record the customer's acceptance (who accepted and how).");
  }
  confirm("note", "Closing notes", String(input.closingNote ?? "").trim().length >= 3, "Write the closing notes.");
  let completionDate = day;
  if (input.completionDate) {
    completionDate = isoDay(input.completionDate);
    const started = project.actual_start_date ? isoDay(project.actual_start_date) : null;
    if (completionDate > day) add("date", "Completion date", "FAIL", "The completion date cannot be in the future.");
    else if (started && completionDate < started) add("date", "Completion date", "FAIL", `The completion date cannot be before the start (${started}).`);
    else add("date", "Completion date", "PASS", `Completed on ${completionDate}.`);
  } else add("date", "Completion date", "PASS", `Completed today (${day}) unless another date is given.`);
  return { checks, completionDate, ready: !checks.some((row) => row.blocking || (preview && row.state === "FAIL")) };
}
// What depends on the project before it is cancelled: linked commercial records (they stay as their modules keep them), the team, an open hold.
export async function cancellationReview(client, c, project) {
  const links = await resolvedLinks(client, c, project.id, { financials: false });
  const dependencies = links.filter((link) => ["SALES_QUOTATION", "SALES_ORDER", "SALES_INVOICE", "PURCHASE_ORDER", "SUPPLIER_BILL"].includes(link.sourceType))
    .map((link) => ({ type: link.typeLabel, number: link.raw?.number ?? null, status: link.raw?.status ?? null, message: `${link.typeLabel} ${link.raw?.number ?? ""} stays as ${link.sourceModule === "PROCUREMENT" ? "Procurement" : link.sourceModule === "FINANCE" ? "Finance" : "Sales"} keeps it.` }));
  const members = Number((await client.query(`SELECT count(*) AS n FROM tenant.project_members WHERE project_id = $1 AND left_at IS NULL`, [project.id])).rows[0].n);
  const hold = (await client.query(`SELECT reason FROM tenant.project_holds WHERE project_id = $1 AND resolved_at IS NULL`, [project.id])).rows[0] ?? null;
  return { dependencies, members, hold: hold?.reason ?? null, notes: [
    "Cancelling deletes nothing: linked documents, notes, files and history stay.",
    members > 1 ? `${members} people are on the team; they keep read access to the history.` : null,
    hold ? `The open hold is closed with the cancellation (${hold.reason}).` : null,
  ].filter(Boolean) };
}
export { ACTIVE_STATUSES };
