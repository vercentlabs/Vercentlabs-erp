// Projects — Billable / Non-Billable Time, what people see: a project's four separate measures (recorded, approved, eligible, invoiced) with
// what is reserved and what is free to request, the approved time free to bill, non-billable time by reason, billing requests, the
// exceptions queue (waiting on Sales, cancelled invoices to reconcile, time without a contract line, lines near their cap), profitability
// (labor cost beside billable and invoiced value — each only for those who may see it) and the billable-time reports.
import { has, seesAll, userNames, uuid } from "../project-core.js";
import { canTeam, companyToday, loadProjectRow, workDay, addDays } from "../timesheets/time-rules.js";
import {
  BILLING, BILLING_METHODS, CLASSIFICATIONS, NON_BILLABLE_REASONS, REQUEST_STATUS, amountFor, billError, billingScope, mayAuthorize, mayRequest, minutesLabel, money, projectBillingPolicy,
  viewsBilling, viewsCost,
} from "./billable-rules.js";
import { requestNames } from "./billable-requests.js";

const flag = (value) => (value ? "TRUE" : "FALSE");
// The projects whose billing this person may read: those they lead, every project (portfolio access), or any (billing roles).
const scopeSql = (c, alias = "project", me = "$2") => `(${flag(seesAll(c) || has(c, BILLING.request) || has(c, BILLING.approve))} OR ${alias}.manager_user_id = ${me})`;
const ENTRY_TOTALS = `
  COALESCE(sum(entry.duration_minutes), 0)::int AS recorded,
  COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.billing_classification IN ('TIME_AND_MATERIALS_ELIGIBLE', 'ELIGIBILITY_PENDING')), 0)::int AS billable,
  COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.billing_classification IN ('NON_BILLABLE', 'INCLUDED_IN_FIXED_FEE')), 0)::int AS non_billable,
  COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.billing_classification = 'INCLUDED_IN_FIXED_FEE'), 0)::int AS included,
  COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.billing_classification IN ('TIME_AND_MATERIALS_ELIGIBLE', 'ELIGIBILITY_PENDING') AND entry.entry_status <> 'APPROVED'), 0)::int AS billable_pending,
  COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.billing_classification IN ('TIME_AND_MATERIALS_ELIGIBLE', 'ELIGIBILITY_PENDING') AND entry.entry_status = 'APPROVED'), 0)::int AS approved_billable,
  COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.billing_classification = 'TIME_AND_MATERIALS_ELIGIBLE' AND entry.entry_status = 'APPROVED'), 0)::int AS approved_eligible,
  COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.billing_classification = 'ELIGIBILITY_PENDING' AND entry.entry_status = 'APPROVED'), 0)::int AS approved_pending_line,
  COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.billing_classification IN ('NON_BILLABLE', 'INCLUDED_IN_FIXED_FEE') AND entry.entry_status = 'APPROVED'), 0)::int AS approved_non_billable,
  COALESCE(sum(entry.duration_minutes) FILTER (WHERE entry.entry_status = 'APPROVED'), 0)::int AS approved`;
const ALLOCATION_TOTALS = `
  COALESCE(sum(allocation.allocated_minutes) FILTER (WHERE allocation.status = 'INVOICED'), 0)::int AS invoiced,
  COALESCE(sum(allocation.allocated_minutes) FILTER (WHERE allocation.status = 'REQUESTED'), 0)::int AS reserved,
  COALESCE(sum(allocation.allocated_minutes * allocation.hourly_rate / 60) FILTER (WHERE allocation.status = 'INVOICED'), 0) AS invoiced_value,
  COALESCE(sum(allocation.allocated_minutes * allocation.hourly_rate / 60) FILTER (WHERE allocation.status = 'REQUESTED'), 0) AS reserved_value`;

function measures(entries, allocations) {
  const available = Math.max(entries.approved_eligible - allocations.invoiced - allocations.reserved, 0);
  const label = (minutes) => minutesLabel(minutes);
  return {
    recordedMinutes: entries.recorded, billableMinutes: entries.billable, nonBillableMinutes: entries.non_billable, includedInFixedFeeMinutes: entries.included,
    billablePendingApprovalMinutes: entries.billable_pending, approvedBillableMinutes: entries.approved_billable, approvedEligibleMinutes: entries.approved_eligible,
    approvedAwaitingContractMinutes: entries.approved_pending_line, approvedNonBillableMinutes: entries.approved_non_billable, approvedMinutes: entries.approved,
    invoicedMinutes: allocations.invoiced, reservedMinutes: allocations.reserved, availableToRequestMinutes: available,
    // All approved eligible time not yet invoiced (including what is reserved), shown beside what is free to request.
    unbilledEligibleMinutes: Math.max(entries.approved_eligible - allocations.invoiced, 0),
    billableRatio: entries.approved ? Math.round((entries.approved_billable / entries.approved) * 1000) / 10 : null,
    labels: { recorded: label(entries.recorded), billable: label(entries.billable), nonBillable: label(entries.non_billable), approvedBillable: label(entries.approved_billable),
      invoiced: label(allocations.invoiced), reserved: label(allocations.reserved), available: label(available) },
  };
}

// ------------------------------------------------------------------ a project
export async function getProjectTimeBillingSummary(client, c, projectId) {
  const project = await loadProjectRow(client, c, projectId);
  const team = canTeam(c, project) || billingScope(c, project);
  if (!team && !has(c, "projects.time.view_own")) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  const own = team ? null : c.userId;
  const entries = (await client.query(`SELECT ${ENTRY_TOTALS} FROM tenant.project_time_entries entry WHERE entry.organization_id = $1 AND entry.project_id = $2 AND entry.entry_status <> 'VOIDED'
      AND ($3::uuid IS NULL OR entry.employee_user_id = $3)`, [c.organizationId, project.id, own])).rows[0];
  const allocations = (await client.query(`SELECT ${ALLOCATION_TOTALS} FROM tenant.project_time_billing_allocations allocation JOIN tenant.project_time_entries entry ON entry.id = allocation.entry_id
      WHERE allocation.organization_id = $1 AND allocation.project_id = $2 AND ($3::uuid IS NULL OR entry.employee_user_id = $3)`, [c.organizationId, project.id, own])).rows[0];
  const policy = await projectBillingPolicy(client, c, project);
  const billing = billingScope(c, project);
  const byReason = (await client.query(`SELECT COALESCE(entry.billing_reason_code, 'UNSPECIFIED') AS reason, sum(entry.duration_minutes)::int AS minutes FROM tenant.project_time_entries entry
      WHERE entry.organization_id = $1 AND entry.project_id = $2 AND entry.entry_status <> 'VOIDED' AND entry.billing_classification IN ('NON_BILLABLE', 'INCLUDED_IN_FIXED_FEE')
        AND ($3::uuid IS NULL OR entry.employee_user_id = $3) GROUP BY 1 ORDER BY 2 DESC`, [c.organizationId, project.id, own])).rows;
  const free = billing ? Number((await client.query(`SELECT COALESCE(sum((entry.duration_minutes - COALESCE(used.n, 0)) * line.hourly_rate / 60), 0) AS value FROM tenant.project_time_entries entry
      JOIN tenant.project_time_contract_lines line ON line.id = entry.contract_line_id
      LEFT JOIN LATERAL (SELECT sum(allocated_minutes) AS n FROM tenant.project_time_billing_allocations a WHERE a.entry_id = entry.id AND a.status <> 'REVERSED') used ON TRUE
      WHERE entry.organization_id = $1 AND entry.project_id = $2 AND entry.entry_status = 'APPROVED' AND entry.billing_classification = 'TIME_AND_MATERIALS_ELIGIBLE'`, [c.organizationId, project.id])).rows[0].value) : null;
  return {
    projectId: project.id, code: project.project_code, scope: team ? "PROJECT" : "MINE", method: policy.method, methodLabel: policy.method ? BILLING_METHODS[policy.method] : "Not set", policyVersion: policy.version,
    ...measures(entries, allocations),
    nonBillableByReason: byReason.map((row) => ({ reasonCode: row.reason, reason: NON_BILLABLE_REASONS[row.reason] ?? "No reason recorded", minutes: row.minutes })),
    ...(billing ? { values: { invoiced: String(money(allocations.invoiced_value)), reserved: String(money(allocations.reserved_value)), availableToRequest: String(money(free ?? 0)) } } : {}),
    can: { request: mayRequest(c, project), authorize: mayAuthorize(c), billing },
  };
}

// Approved, eligible time with minutes free to request (reserved and invoiced minutes are not free). filters: { projectId?, contractLineId? }
export async function getApprovedUnbilledTime(client, c, filters = {}) {
  if (!viewsBilling(c)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  const rows = (await client.query(`SELECT entry.id, entry.entry_number, entry.project_id, entry.employee_user_id, to_char(entry.work_date, 'YYYY-MM-DD') AS work_date, entry.duration_minutes, entry.description,
        entry.contract_line_id, line.label AS line_label, line.hourly_rate, line.currency, line.rounding_minutes, project.project_code, project.name AS project_name, task.task_code, task.title AS task_title,
        COALESCE((SELECT sum(a.allocated_minutes) FILTER (WHERE a.status = 'INVOICED') FROM tenant.project_time_billing_allocations a WHERE a.entry_id = entry.id), 0)::int AS invoiced,
        COALESCE((SELECT sum(a.allocated_minutes) FILTER (WHERE a.status = 'REQUESTED') FROM tenant.project_time_billing_allocations a WHERE a.entry_id = entry.id), 0)::int AS reserved
      FROM tenant.project_time_entries entry JOIN tenant.projects project ON project.id = entry.project_id JOIN tenant.project_time_contract_lines line ON line.id = entry.contract_line_id
      LEFT JOIN tenant.project_tasks task ON task.id = entry.task_id
      WHERE entry.organization_id = $1 AND entry.entry_status = 'APPROVED' AND entry.billing_classification = 'TIME_AND_MATERIALS_ELIGIBLE' AND ${scopeSql(c)}
        AND ($3::uuid IS NULL OR entry.project_id = $3) AND ($4::uuid IS NULL OR entry.contract_line_id = $4)
      ORDER BY project.project_code, entry.work_date, entry.entry_number`,
  [c.organizationId, c.userId ?? null, filters.projectId ? uuid(filters.projectId, "Project") : null, filters.contractLineId ? uuid(filters.contractLineId, "Contract line") : null])).rows;
  const names = await userNames(client, rows.map((row) => row.employee_user_id));
  const view = rows.map((row) => {
    const free = row.duration_minutes - row.invoiced - row.reserved;
    return { entryId: row.id, entryNumber: `TE-${row.entry_number}`, projectId: row.project_id, project: `${row.project_code} · ${row.project_name ?? ""}`, task: row.task_code ? `${row.task_code} · ${row.task_title}` : null,
      employee: names.get(row.employee_user_id) ?? null, workDate: row.work_date, description: row.description, contractLineId: row.contract_line_id, contractLine: row.line_label, roundingMinutes: row.rounding_minutes,
      approvedMinutes: row.duration_minutes, invoicedMinutes: row.invoiced, reservedMinutes: row.reserved, freeMinutes: Math.max(free, 0),
      state: row.invoiced >= row.duration_minutes ? "INVOICED" : row.invoiced + row.reserved >= row.duration_minutes ? "ALLOCATED" : row.invoiced + row.reserved > 0 ? "PARTIALLY_ALLOCATED" : "UNBILLED",
      rate: String(row.hourly_rate), currency: row.currency, freeValue: String(amountFor(Math.max(free, 0), row.hourly_rate)) };
  });
  return { rows: filters.all ? view : view.filter((row) => row.freeMinutes > 0), totalFreeMinutes: view.reduce((sum, row) => sum + row.freeMinutes, 0) };
}
export const getApprovedBillableTime = (client, c, filters = {}) => getApprovedUnbilledTime(client, c, { ...filters, all: true });

export async function getNonBillableTimeSummary(client, c, filters = {}) {
  if (!has(c, "projects.time.view_team") && !viewsBilling(c)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  const rows = (await client.query(`SELECT entry.billing_classification, COALESCE(entry.billing_reason_code, 'UNSPECIFIED') AS reason, sum(entry.duration_minutes)::int AS minutes, count(*)::int AS entries,
        sum(entry.cost_amount) AS cost FROM tenant.project_time_entries entry JOIN tenant.projects project ON project.id = entry.project_id
      WHERE entry.organization_id = $1 AND entry.entry_status <> 'VOIDED' AND entry.billing_classification IN ('NON_BILLABLE', 'INCLUDED_IN_FIXED_FEE') AND ${scopeSql(c)} AND ($3::uuid IS NULL OR entry.project_id = $3)
      GROUP BY 1, 2 ORDER BY 3 DESC`, [c.organizationId, c.userId ?? null, filters.projectId ? uuid(filters.projectId, "Project") : null])).rows;
  return { rows: rows.map((row) => ({ classification: row.billing_classification, classificationLabel: CLASSIFICATIONS[row.billing_classification], reasonCode: row.reason,
    reason: NON_BILLABLE_REASONS[row.reason] ?? "No reason recorded", minutes: row.minutes, entries: row.entries, ...(viewsCost(c) ? { cost: row.cost === null ? null : String(row.cost) } : {}) })) };
}

// ------------------------------------------------------------------ requests
const requestView = (row, names, billing) => ({
  id: row.id, number: `BR-${row.request_number}`, projectId: row.project_id, project: row.project_code ? `${row.project_code} · ${row.project_name ?? ""}` : null, contractLineId: row.contract_line_id,
  contractLine: row.line_label ?? null, status: row.status, statusLabel: REQUEST_STATUS[row.status], totalMinutes: row.total_minutes, creditedMinutes: row.credited_minutes, total: minutesLabel(row.total_minutes),
  invoiceNumber: row.invoice_number ?? null, note: row.note, cancelReason: row.cancel_reason, version: row.row_version,
  createdBy: names.get(row.created_by) ?? null, createdAt: row.created_at, submittedBy: names.get(row.submitted_by) ?? null, submittedAt: row.submitted_at,
  invoicedBy: names.get(row.invoiced_by) ?? null, invoicedAt: row.invoiced_at, cancelledBy: names.get(row.cancelled_by) ?? null, cancelledAt: row.cancelled_at,
  ...(billing ? { hourlyRate: row.hourly_rate === null ? null : String(row.hourly_rate), currency: row.currency, estimatedAmount: row.estimated_amount === null ? null : String(row.estimated_amount),
    invoicedAmount: row.invoiced_amount === null ? null : String(row.invoiced_amount) } : {}),
});
const REQUEST_SELECT = `SELECT request.*, project.project_code, project.name AS project_name, project.manager_user_id, line.label AS line_label, invoice.invoice_number
  FROM tenant.project_time_billing_requests request JOIN tenant.projects project ON project.id = request.project_id
  LEFT JOIN tenant.project_time_contract_lines line ON line.id = request.contract_line_id LEFT JOIN tenant.accounting_customer_invoices invoice ON invoice.id = request.customer_invoice_id`;

export async function listTimeBillingRequests(client, c, filters = {}) {
  if (!viewsBilling(c)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  const status = REQUEST_STATUS[filters.status] ? filters.status : null;
  const rows = (await client.query(`${REQUEST_SELECT} WHERE request.organization_id = $1 AND ${scopeSql(c)} AND ($3::text IS NULL OR request.status = $3) AND ($4::uuid IS NULL OR request.project_id = $4)
      ORDER BY request.created_at DESC LIMIT 300`, [c.organizationId, c.userId ?? null, status, filters.projectId ? uuid(filters.projectId, "Project") : null])).rows;
  const names = await requestNames(client, rows);
  return { rows: rows.map((row) => requestView(row, names, true)), can: { authorize: mayAuthorize(c) } };
}

export async function getTimeBillingRequest(client, c, requestId) {
  if (!viewsBilling(c)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  const row = (await client.query(`${REQUEST_SELECT} WHERE request.organization_id = $1 AND request.id = $3 AND ${scopeSql(c)}`, [c.organizationId, c.userId ?? null, uuid(requestId, "Billing request")])).rows[0];
  if (!row) throw billError(404, "TIME_BILLING_NOT_FOUND");
  const allocations = (await client.query(`SELECT allocation.*, entry.entry_number, entry.employee_user_id, to_char(entry.work_date, 'YYYY-MM-DD') AS work_date, entry.description, entry.entry_status
      FROM tenant.project_time_billing_allocations allocation JOIN tenant.project_time_entries entry ON entry.id = allocation.entry_id WHERE allocation.billing_request_id = $1 ORDER BY allocation.requested_at, entry.entry_number`,
  [row.id])).rows;
  const names = await userNames(client, [row.created_by, row.submitted_by, row.invoiced_by, row.cancelled_by, ...allocations.map((a) => a.employee_user_id), ...allocations.map((a) => a.reversed_by)]);
  const project = await loadProjectRow(client, c, row.project_id);
  const settings = (await client.query(`SELECT time_billing_request_approval FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0];
  const approval = settings?.time_billing_request_approval ?? true;
  return {
    ...requestView(row, names, true),
    allocations: allocations.map((a) => ({ id: a.id, entryId: a.entry_id, entryNumber: `TE-${a.entry_number}`, employee: names.get(a.employee_user_id) ?? null, workDate: a.work_date, description: a.description,
      minutes: a.allocated_minutes, status: a.status, reversalKind: a.reversal_kind, reversalReason: a.reversal_reason, reversalReference: a.reversal_reference, reversedBy: names.get(a.reversed_by) ?? null, reversedAt: a.reversed_at })),
    can: {
      submit: row.status === "DRAFT" && (approval ? mayAuthorize(c) && row.created_by !== c.userId : mayRequest(c, project) || mayAuthorize(c)),
      cancel: (row.status === "DRAFT" && (mayAuthorize(c) || (mayRequest(c, project) && row.created_by === c.userId))) || (row.status === "SUBMITTED" && mayAuthorize(c)),
      confirm: row.status === "SUBMITTED" && mayAuthorize(c), reconcile: row.status === "INVOICED" && mayAuthorize(c),
    },
  };
}

// What needs attention: requests with Sales for a week with no invoice (their minutes stay reserved — an unknown outcome never frees them),
// invoiced requests whose invoice was cancelled or reversed, approved billable time without a valid contract line, lines near their cap.
export async function getTimeBillingExceptions(client, c) {
  if (!viewsBilling(c)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  const today = await companyToday(client, c);
  const values = [c.organizationId, c.userId ?? null];
  const waiting = (await client.query(`${REQUEST_SELECT} WHERE request.organization_id = $1 AND ${scopeSql(c)} AND request.status = 'SUBMITTED' AND request.submitted_at < now() - interval '7 days'`, values)).rows;
  const cancelled = (await client.query(`${REQUEST_SELECT} WHERE request.organization_id = $1 AND ${scopeSql(c)} AND request.status = 'INVOICED' AND invoice.status IN ('cancelled', 'reversed')`, values)).rows;
  const pending = (await client.query(`SELECT project.id AS project_id, project.project_code, count(*)::int AS entries, sum(entry.duration_minutes)::int AS minutes FROM tenant.project_time_entries entry
      JOIN tenant.projects project ON project.id = entry.project_id WHERE entry.organization_id = $1 AND entry.entry_status = 'APPROVED' AND entry.billing_classification = 'ELIGIBILITY_PENDING' AND ${scopeSql(c)}
      GROUP BY 1, 2 ORDER BY 4 DESC`, values)).rows;
  const caps = (await client.query(`SELECT line.id, line.label, line.max_minutes, project.project_code, COALESCE((SELECT sum(a.allocated_minutes) FROM tenant.project_time_billing_allocations a
        WHERE a.contract_line_id = line.id AND a.status <> 'REVERSED'), 0)::int AS used FROM tenant.project_time_contract_lines line JOIN tenant.projects project ON project.id = line.project_id
      WHERE line.organization_id = $1 AND line.status = 'ACTIVE' AND line.max_minutes IS NOT NULL AND ${scopeSql(c)}`, values)).rows.filter((row) => row.used >= row.max_minutes * 0.9);
  const names = await requestNames(client, [...waiting, ...cancelled]);
  return {
    asOf: today,
    rows: [
      ...waiting.map((row) => ({ kind: "AWAITING_INVOICE", label: "With Sales for over a week, no invoice linked", request: requestView(row, names, true), message: "The minutes stay reserved until Sales confirms the invoice or the request is cancelled." })),
      ...cancelled.map((row) => ({ kind: "INVOICE_CANCELLED", label: "Invoice cancelled or reversed", request: requestView(row, names, true), message: `Reconcile ${row.invoice_number} to release its minutes.` })),
      ...pending.map((row) => ({ kind: "CONTRACT_MISSING", label: "Approved billable time without a contract line", projectId: row.project_id, project: row.project_code, minutes: row.minutes,
        message: `${row.entries} entr${row.entries === 1 ? "y" : "ies"} (${minutesLabel(row.minutes)}) wait for a contract line.` })),
      ...caps.map((row) => ({ kind: "LIMIT_NEAR", label: "Contract allowance nearly used", project: row.project_code, contractLine: row.label, minutes: row.used,
        message: `${minutesLabel(row.used)} of ${minutesLabel(row.max_minutes)} used on ${row.label}.` })),
    ],
  };
}

// ------------------------------------------------------------------ reports
export const BILLABLE_REPORTS = Object.freeze(["billable-vs-nonbillable", "by-project", "nonbillable-by-reason", "by-employee", "approved-billable", "pending-approval", "approved-unbilled",
  "partially-billed", "invoiced", "fixed-fee-included", "value-estimate", "invoiced-value", "labor-cost", "corrections", "exceptions"]);
const VALUE_REPORTS = ["approved-unbilled", "partially-billed", "invoiced", "value-estimate", "invoiced-value", "exceptions"];
// filters: { from?, to?, projectId? }
export async function getBillableTimeReport(client, c, kind = "billable-vs-nonbillable", filters = {}) {
  if (!BILLABLE_REPORTS.includes(kind)) throw billError(400, "TIME_BILLING_NOT_FOUND", "Unknown report.");
  if (kind === "labor-cost" ? !viewsCost(c) : VALUE_REPORTS.includes(kind) ? !viewsBilling(c) : !(has(c, "projects.time.view_team") || viewsBilling(c))) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  if (kind === "exceptions") return (await getTimeBillingExceptions(client, c)).rows;
  const today = await companyToday(client, c);
  const from = filters.from ? workDay(filters.from, "start date") : addDays(today, -90);
  const to = filters.to ? workDay(filters.to, "end date") : today;
  const values = [c.organizationId, c.userId ?? null, from, to, filters.projectId ? uuid(filters.projectId, "Project") : null];
  const where = `entry.organization_id = $1 AND entry.entry_status <> 'VOIDED' AND entry.work_date BETWEEN $3 AND $4 AND ($5::uuid IS NULL OR entry.project_id = $5) AND ${scopeSql(c)}`;
  const FROM = `FROM tenant.project_time_entries entry JOIN tenant.projects project ON project.id = entry.project_id`;
  const ALLOC = `LEFT JOIN LATERAL (SELECT sum(a.allocated_minutes) FILTER (WHERE a.status = 'INVOICED') AS invoiced, sum(a.allocated_minutes) FILTER (WHERE a.status = 'REQUESTED') AS reserved
    FROM tenant.project_time_billing_allocations a WHERE a.entry_id = entry.id) alloc ON TRUE`;
  const q = async (sql) => (await client.query(sql, values)).rows;
  const named = async (rows, field) => { const names = await userNames(client, rows.map((row) => row[field])); return rows.map((row) => ({ ...row, [`${field}_name`]: names.get(row[field]) ?? null })); };
  switch (kind) {
    case "billable-vs-nonbillable": return q(`SELECT entry.billing_classification AS classification, entry.entry_status AS status, sum(entry.duration_minutes)::int AS minutes, count(*)::int AS entries ${FROM}
      WHERE ${where} GROUP BY 1, 2 ORDER BY 1, 2`);
    case "by-project": return q(`SELECT project.id AS project_id, project.project_code, project.name AS project_name, ${ENTRY_TOTALS}, COALESCE(sum(alloc.invoiced), 0)::int AS invoiced, COALESCE(sum(alloc.reserved), 0)::int AS reserved
      ${FROM} ${ALLOC} WHERE ${where} GROUP BY 1, 2, 3 ORDER BY recorded DESC`);
    case "by-employee": return named(await q(`SELECT entry.employee_user_id, ${ENTRY_TOTALS} ${FROM} WHERE ${where} GROUP BY 1 ORDER BY recorded DESC`), "employee_user_id");
    case "nonbillable-by-reason": return q(`SELECT entry.billing_classification AS classification, COALESCE(entry.billing_reason_code, 'UNSPECIFIED') AS reason, sum(entry.duration_minutes)::int AS minutes, count(*)::int AS entries
      ${FROM} WHERE ${where} AND entry.billing_classification IN ('NON_BILLABLE', 'INCLUDED_IN_FIXED_FEE') GROUP BY 1, 2 ORDER BY 3 DESC`);
    case "fixed-fee-included": return q(`SELECT project.project_code, project.name AS project_name, sum(entry.duration_minutes)::int AS minutes, sum(entry.duration_minutes) FILTER (WHERE entry.entry_status = 'APPROVED')::int AS approved
      ${FROM} WHERE ${where} AND entry.billing_classification = 'INCLUDED_IN_FIXED_FEE' GROUP BY 1, 2 ORDER BY 3 DESC`);
    case "approved-billable": case "pending-approval": case "approved-unbilled": case "partially-billed": case "invoiced": case "value-estimate": {
      const extra = { "approved-billable": "entry.entry_status = 'APPROVED' AND entry.billing_classification IN ('TIME_AND_MATERIALS_ELIGIBLE', 'ELIGIBILITY_PENDING')",
        "pending-approval": "entry.entry_status IN ('DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED') AND entry.billing_classification IN ('TIME_AND_MATERIALS_ELIGIBLE', 'ELIGIBILITY_PENDING')",
        "approved-unbilled": "entry.entry_status = 'APPROVED' AND entry.billing_classification = 'TIME_AND_MATERIALS_ELIGIBLE' AND entry.duration_minutes > COALESCE(alloc.invoiced, 0) + COALESCE(alloc.reserved, 0)",
        "partially-billed": "entry.entry_status = 'APPROVED' AND COALESCE(alloc.invoiced, 0) + COALESCE(alloc.reserved, 0) > 0 AND entry.duration_minutes > COALESCE(alloc.invoiced, 0) + COALESCE(alloc.reserved, 0)",
        invoiced: "COALESCE(alloc.invoiced, 0) > 0", "value-estimate": "entry.entry_status = 'APPROVED' AND entry.billing_classification = 'TIME_AND_MATERIALS_ELIGIBLE'" }[kind];
      return named(await q(`SELECT entry.id, entry.entry_number, entry.employee_user_id, project.project_code, to_char(entry.work_date, 'YYYY-MM-DD') AS work_date, entry.duration_minutes, entry.entry_status, entry.billing_classification,
          COALESCE(alloc.invoiced, 0)::int AS invoiced, COALESCE(alloc.reserved, 0)::int AS reserved, line.label AS contract_line,
          ${viewsBilling(c) ? "line.hourly_rate, line.currency, round(entry.duration_minutes * line.hourly_rate / 60, 2) AS value," : ""} entry.description
        ${FROM} ${ALLOC} LEFT JOIN tenant.project_time_contract_lines line ON line.id = entry.contract_line_id WHERE ${where} AND ${extra} ORDER BY entry.work_date DESC LIMIT 1000`), "employee_user_id");
    }
    case "invoiced-value": return q(`SELECT request.request_number, project.project_code, invoice.invoice_number, invoice.status AS invoice_status, request.total_minutes, request.credited_minutes, request.hourly_rate, request.currency,
        request.estimated_amount, request.invoiced_amount, request.status FROM tenant.project_time_billing_requests request JOIN tenant.projects project ON project.id = request.project_id
        LEFT JOIN tenant.accounting_customer_invoices invoice ON invoice.id = request.customer_invoice_id
        WHERE request.organization_id = $1 AND request.status IN ('INVOICED', 'REVERSED') AND request.invoiced_at::date BETWEEN $3 AND $4 AND ($5::uuid IS NULL OR request.project_id = $5) AND ${scopeSql(c)}
        ORDER BY request.invoiced_at DESC`);
    case "labor-cost": return q(`SELECT project.project_code, project.name AS project_name, entry.billing_classification AS classification, sum(entry.duration_minutes)::int AS minutes, sum(entry.cost_amount) AS cost,
        min(entry.cost_currency) AS currency, count(*) FILTER (WHERE entry.cost_recorded_at IS NULL)::int AS without_rate ${FROM} WHERE ${where} AND entry.entry_status = 'APPROVED'
        GROUP BY 1, 2, 3 ORDER BY 1, 3`);
    case "corrections": return named(await q(`SELECT correction.correction_number, correction.employee_user_id, project.project_code, correction.reason, correction.status, correction.original, correction.proposed,
        correction.billing_adjustment_required, correction.billing_adjustment_reference, correction.requested_at FROM tenant.project_time_corrections correction JOIN tenant.projects project ON project.id = correction.project_id
        JOIN tenant.project_time_entries entry ON entry.id = correction.entry_id
        WHERE ${where.replace("entry.entry_status <> 'VOIDED' AND ", "")} AND ((correction.original ->> 'billable') IS DISTINCT FROM (correction.proposed ->> 'billable') OR correction.proposed ? 'parts'
          OR (correction.original ->> 'reasonCode') IS DISTINCT FROM (correction.proposed ->> 'reasonCode') OR correction.billing_adjustment_required) ORDER BY correction.requested_at DESC`), "employee_user_id");
    default: return [];
  }
}

// What Sales has that could close this request: confirmed invoice lines of the project's customer billing exactly its hours (and not already
// carrying a request), and the credit notes issued against its invoice.
export async function getTimeBillingInvoiceCandidates(client, c, requestId) {
  if (!viewsBilling(c)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  const request = (await client.query(`SELECT * FROM tenant.project_time_billing_requests WHERE organization_id = $1 AND id = $2`, [c.organizationId, uuid(requestId, "Billing request")])).rows[0];
  if (!request) throw billError(404, "TIME_BILLING_NOT_FOUND");
  const lines = (await client.query(`SELECT line.id, line.description, line.quantity, line.net_amount, invoice.invoice_number, invoice.invoice_date, invoice.status FROM tenant.accounting_customer_invoice_lines line
      JOIN tenant.accounting_customer_invoices invoice ON invoice.id = line.customer_invoice_id
      WHERE line.organization_id = $1 AND invoice.party_id = $2 AND invoice.invoice_type = 'invoice' AND invoice.status IN ('approved', 'posted', 'partially_paid', 'paid', 'overdue', 'disputed')
        AND (line.quantity IS NULL OR abs(line.quantity * 60 - $3) < 0.5)
        AND NOT EXISTS (SELECT 1 FROM tenant.project_time_billing_requests other WHERE other.customer_invoice_line_id = line.id AND other.status IN ('INVOICED', 'SUBMITTED') AND other.id <> $4)
      ORDER BY invoice.invoice_date DESC LIMIT 50`, [c.organizationId, request.customer_id, request.total_minutes, request.id])).rows;
  const notes = request.customer_invoice_id ? (await client.query(`SELECT id, invoice_number, invoice_date, status, grand_total FROM tenant.accounting_customer_invoices
      WHERE organization_id = $1 AND invoice_type = 'credit_note' AND source_invoice_id = $2 AND status NOT IN ('draft', 'cancelled') ORDER BY invoice_date DESC`, [c.organizationId, request.customer_invoice_id])).rows : [];
  return {
    invoiceLines: lines.map((row) => ({ id: row.id, label: `${row.invoice_number} · ${row.description}${row.quantity === null ? "" : ` · ${Number(row.quantity)} h`} · ${row.net_amount}`, invoiceNumber: row.invoice_number })),
    creditNotes: notes.map((row) => ({ id: row.id, label: `${row.invoice_number} · ${row.grand_total ?? ""}`.trim(), number: row.invoice_number })),
  };
}
