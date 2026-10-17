// Projects — Invoice From Billable Time. Projects identifies the billable work; Sales creates and owns the invoice; Finance owns the
// accounting. Approved, contract-eligible minutes are chosen (whole entries or part of one), previewed at the contract's agreed rate with
// the Sales tax engine's figures, reserved in billing requests (each minute once — entries and contract lines locked, the database checks
// again) and turned into a Sales Invoice Draft by the Sales invoice engine (its number, tax, terms and posting). Sales reviews and posts
// it; the posting is read back and the minutes become invoiced; a cancelled draft releases them. A reversed or credited invoice never
// frees minutes by itself: an authorized disposition decides whether they may be billed again. Nothing here posts, numbers or taxes.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { has, isoDay, projectEvent, seesAll, text, userNames, uuid, visibilitySql } from "../project-core.js";
import { createInvoiceFromSalesOrder, registerInvoiceLifecycleListener } from "../../sales/invoices/records.js";
import { buildInvoiceLines, invoiceableLines, orderSource, taxEngineFor } from "../../sales/invoices/build.js";
import { amountFor, billError, billingSettings, keyOf, loadContractLine, mayAuthorize, mayRequest, minutesLabel, viewsBilling } from "../billable/billable-rules.js";
import { createTimeBillingRequest } from "../billable/billable-requests.js";
import { loadProjectRow } from "../timesheets/time-rules.js";

const MESSAGES = Object.freeze({
  TIME_INVOICE_NO_ELIGIBLE_TIME: "No approved billable time is available for this selection.",
  TIME_INVOICE_UNAPPROVED_SOURCE: "One or more time entries still need approval.",
  TIME_INVOICE_SOURCE_ALREADY_RESERVED: "Some selected hours are already reserved for another invoice.",
  TIME_INVOICE_QUANTITY_EXCEEDED: "The selected hours exceed the remaining billable time.",
  TIME_INVOICE_CONTRACT_MISSING: "Link a valid Sales contract or order line.",
  TIME_INVOICE_CUSTOMER_MISMATCH: "The Sales Order belongs to another customer.",
  TIME_INVOICE_FIXED_FEE_INCLUDED: "This work is already included in the fixed-price agreement.",
  TIME_INVOICE_RATE_INVALID: "The agreed billing rate is missing or no longer valid.",
  TIME_INVOICE_CONTRACT_CAP_EXCEEDED: "The selected time exceeds the remaining contract allowance.",
  TIME_INVOICE_TAX_VALIDATION: "Review customer and service tax details in Sales.",
  TIME_INVOICE_DRAFT_ALREADY_EXISTS: "A Sales Invoice Draft already exists for this billing request.",
  TIME_INVOICE_VERSION_CONFLICT: "Timesheet or contract data changed. Refresh and review.",
  TIME_INVOICE_PERMISSION_DENIED: "You are not authorized to perform this action.",
  TIME_INVOICE_PERIOD_CLOSED: "This invoice cannot be issued in a closed financial period.",
  TIME_INVOICE_RECOVERY_REQUIRED: "The invoice outcome is being reconciled. Do not submit again.",
  TIME_INVOICE_INPUT_INVALID: "Check the details and try again.",
});
export const TIME_INVOICE_MESSAGES = MESSAGES;
const invoiceError = (status, code, message, details) => billError(status, code, message ?? MESSAGES[code], details);
// Sales's map of an existing billing error to this feature's words.
const MAP = { TIME_BILLING_HOURS_UNAPPROVED: "TIME_INVOICE_UNAPPROVED_SOURCE", TIME_BILLING_ALREADY_ALLOCATED: "TIME_INVOICE_SOURCE_ALREADY_RESERVED", TIME_BILLING_CONTRACT_MISSING: "TIME_INVOICE_CONTRACT_MISSING",
  TIME_BILLING_CUSTOMER_MISMATCH: "TIME_INVOICE_CUSTOMER_MISMATCH", TIME_BILLING_FIXED_FEE_INCLUDED: "TIME_INVOICE_FIXED_FEE_INCLUDED", TIME_BILLING_RATE_MISSING: "TIME_INVOICE_RATE_INVALID",
  TIME_BILLING_LIMIT_EXCEEDED: "TIME_INVOICE_CONTRACT_CAP_EXCEEDED", TIME_BILLING_PERMISSION_DENIED: "TIME_INVOICE_PERMISSION_DENIED", TIME_BILLING_VERSION_CONFLICT: "TIME_INVOICE_VERSION_CONFLICT" };
const translate = (failure) => {
  if (failure?.code && MAP[failure.code]) { failure.code = MAP[failure.code]; }
  return failure;
};
const CONFIRMED = ["approved", "posted", "partially_paid", "paid", "overdue", "disputed"];
// Hours as a decimal with no hidden gain or loss: 3 minutes is exactly 0.05 h; anything finer is refused.
const hoursOf = (minutes) => {
  if (minutes % 3 !== 0) throw invoiceError(400, "TIME_INVOICE_INPUT_INVALID", `${minutesLabel(minutes)} is not a whole number of 0.05-hour steps; bill in steps of 3 minutes.`);
  return (minutes / 60).toFixed(2);
};
const companyDay = async (client, c) => (await client.query(`SELECT to_char((now() AT TIME ZONE COALESCE((SELECT timezone FROM public.organizations WHERE id = $1), 'UTC'))::date, 'YYYY-MM-DD') AS d`,
  [c.organizationId])).rows[0].d;
const salesMay = (c, key) => has(c, key);

// ------------------------------------------------------------------ eligible time
// filters: { from?, to?, taskId?, employeeId?, contractLineId? } — approved, separately chargeable time with minutes still free to bill.
export async function getInvoiceEligibleProjectTime(client, c, projectId, filters = {}) {
  const project = await loadProjectRow(client, c, projectId);
  if (!viewsBilling(c)) throw invoiceError(403, "TIME_INVOICE_PERMISSION_DENIED");
  const values = [c.organizationId, project.id];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["entry.organization_id = $1", "entry.project_id = $2", "entry.entry_status = 'APPROVED'", "entry.billing_classification = 'TIME_AND_MATERIALS_ELIGIBLE'"];
  if (filters.from) where.push(`entry.work_date >= ${bind(isoDay(filters.from))}::date`);
  if (filters.to) where.push(`entry.work_date <= ${bind(isoDay(filters.to))}::date`);
  if (filters.taskId) where.push(`entry.task_id = ${bind(uuid(filters.taskId, "Task"))}`);
  if (filters.employeeId) where.push(`entry.employee_user_id = ${bind(uuid(filters.employeeId, "Employee"))}`);
  if (filters.contractLineId) where.push(`entry.contract_line_id = ${bind(uuid(filters.contractLineId, "Contract line"))}`);
  const rows = (await client.query(`SELECT entry.id, entry.entry_number, entry.employee_user_id, to_char(entry.work_date, 'YYYY-MM-DD') AS work_date, entry.duration_minutes, entry.description, entry.row_version,
        entry.contract_line_id, line.label, line.hourly_rate, line.currency, line.rounding_minutes, line.max_minutes, so.sales_order_number, so.id AS sales_order_id, task.task_code, task.title AS task_title,
        COALESCE((SELECT sum(a.allocated_minutes) FILTER (WHERE a.status = 'INVOICED') FROM tenant.project_time_billing_allocations a WHERE a.entry_id = entry.id), 0)::int AS invoiced,
        COALESCE((SELECT sum(a.allocated_minutes) FILTER (WHERE a.status = 'REQUESTED') FROM tenant.project_time_billing_allocations a WHERE a.entry_id = entry.id), 0)::int AS reserved
      FROM tenant.project_time_entries entry JOIN tenant.project_time_contract_lines line ON line.id = entry.contract_line_id JOIN tenant.sales_orders so ON so.id = line.sales_order_id
      LEFT JOIN tenant.project_tasks task ON task.id = entry.task_id
     WHERE ${where.join(" AND ")} ORDER BY entry.work_date, entry.entry_number`, values)).rows;
  const names = await userNames(client, rows.map((row) => row.employee_user_id));
  const entries = rows.map((row) => {
    const free = Math.max(row.duration_minutes - row.invoiced - row.reserved, 0);
    return { entryId: row.id, entryNumber: `TE-${row.entry_number}`, version: row.row_version, workDate: row.work_date, employeeId: row.employee_user_id, employee: names.get(row.employee_user_id) ?? null,
      task: row.task_code ? `${row.task_code} · ${row.task_title}` : null, description: row.description, contractLineId: row.contract_line_id, contractLine: row.label, salesOrder: row.sales_order_number,
      salesOrderId: row.sales_order_id, rate: String(row.hourly_rate), currency: row.currency, roundingMinutes: row.rounding_minutes,
      approvedMinutes: row.duration_minutes, invoicedMinutes: row.invoiced, reservedMinutes: row.reserved, availableMinutes: free };
  });
  const lines = new Map();
  for (const entry of entries) {
    const line = lines.get(entry.contractLineId) ?? { contractLineId: entry.contractLineId, label: entry.contractLine, salesOrder: entry.salesOrder, salesOrderId: entry.salesOrderId, rate: entry.rate, currency: entry.currency,
      approvedMinutes: 0, invoicedMinutes: 0, reservedMinutes: 0, availableMinutes: 0 };
    for (const key of ["approvedMinutes", "invoicedMinutes", "reservedMinutes", "availableMinutes"]) line[key] += entry[key];
    lines.set(entry.contractLineId, line);
  }
  const sum = (key) => entries.reduce((total, entry) => total + entry[key], 0);
  return { projectId: project.id, entries: filters.all ? entries : entries.filter((entry) => entry.availableMinutes > 0), contractLines: [...lines.values()],
    totals: { approvedMinutes: sum("approvedMinutes"), invoicedMinutes: sum("invoicedMinutes"), reservedMinutes: sum("reservedMinutes"), availableMinutes: sum("availableMinutes") } };
}

// ------------------------------------------------------------------ the plan: selection → invoice lines, validated
// The selection grouped into the invoice lines it would make: one per contract line (one service, rate and currency), all on one Sales
// Order of the project's customer. Validates approval, eligibility, free minutes, the contract, the rate against the order and the cap.
async function planOf(client, c, project, selection) {
  const asked = Array.isArray(selection) ? selection : [];
  if (!asked.length) throw invoiceError(400, "TIME_INVOICE_NO_ELIGIBLE_TIME");
  const ids = [...new Set(asked.map((row) => uuid(row.entryId, "Time entry")))];
  if (ids.length !== asked.length) throw invoiceError(400, "TIME_INVOICE_INPUT_INVALID", "Each entry appears once.");
  const entries = new Map((await client.query(`SELECT entry.*, COALESCE((SELECT sum(a.allocated_minutes) FROM tenant.project_time_billing_allocations a WHERE a.entry_id = entry.id AND a.status <> 'REVERSED'), 0)::int AS used
      FROM tenant.project_time_entries entry WHERE entry.organization_id = $1 AND entry.id = ANY($2::uuid[])`, [c.organizationId, ids])).rows.map((row) => [row.id, row]));
  const groups = new Map();
  for (const ask of asked) {
    const entry = entries.get(ask.entryId);
    if (!entry || entry.project_id !== project.id) throw invoiceError(400, "TIME_INVOICE_NO_ELIGIBLE_TIME", "That time is not on this project.");
    if (entry.entry_status !== "APPROVED") throw invoiceError(409, "TIME_INVOICE_UNAPPROVED_SOURCE", `TE-${entry.entry_number} is not approved.`);
    if (entry.billing_classification === "INCLUDED_IN_FIXED_FEE") throw invoiceError(400, "TIME_INVOICE_FIXED_FEE_INCLUDED", `TE-${entry.entry_number} is included in the fixed-price agreement.`);
    if (entry.billing_classification !== "TIME_AND_MATERIALS_ELIGIBLE" || !entry.contract_line_id) throw invoiceError(400, "TIME_INVOICE_CONTRACT_MISSING", `TE-${entry.entry_number} has no chargeable contract line.`);
    if (ask.expectedVersion !== undefined && ask.expectedVersion !== null && Number(ask.expectedVersion) !== Number(entry.row_version)) throw invoiceError(409, "TIME_INVOICE_VERSION_CONFLICT");
    const free = entry.duration_minutes - entry.used;
    const minutes = ask.minutes === undefined || ask.minutes === null ? free : Number(ask.minutes);
    if (free <= 0) throw invoiceError(409, "TIME_INVOICE_SOURCE_ALREADY_RESERVED", `TE-${entry.entry_number} is already reserved or invoiced in full.`);
    if (!Number.isInteger(minutes) || minutes <= 0) throw invoiceError(400, "TIME_INVOICE_INPUT_INVALID", "Choose a whole number of minutes, more than zero.");
    if (minutes > free) throw invoiceError(409, "TIME_INVOICE_QUANTITY_EXCEEDED", `TE-${entry.entry_number} has ${minutesLabel(free)} left to bill.`, { entryId: entry.id, availableMinutes: free });
    const group = groups.get(entry.contract_line_id) ?? { contractLineId: entry.contract_line_id, entries: [], minutes: 0 };
    group.entries.push({ entryId: entry.id, minutes, entryNumber: `TE-${entry.entry_number}` });
    group.minutes += minutes;
    groups.set(entry.contract_line_id, group);
  }
  const plan = [];
  let orderId = null;
  for (const group of groups.values()) {
    const line = await loadContractLine(client, c, group.contractLineId);
    if (!line || line.status !== "ACTIVE" || ["cancelled", "draft"].includes(line.order_status)) throw invoiceError(400, "TIME_INVOICE_CONTRACT_MISSING", `${line?.label ?? "That contract line"} cannot be billed: its order or line is not active.`);
    if (!project.customer_id || line.order_party_id !== project.customer_id) throw invoiceError(400, "TIME_INVOICE_CUSTOMER_MISMATCH");
    if (orderId && orderId !== line.sales_order_id) throw invoiceError(400, "TIME_INVOICE_INPUT_INVALID", "This selection spans several Sales Orders: create one invoice per order.");
    orderId = line.sales_order_id;
    // The rate is the order line's: a contract line whose rate no longer matches the confirmed order is not billed silently.
    const orderLine = (await client.query(`SELECT order_line.id, order_line.unit_price, order_line.item_name_snapshot FROM tenant.sales_order_lines order_line JOIN tenant.sales_orders so ON so.current_version_id = order_line.sales_order_version_id
       WHERE order_line.organization_id = $1 AND so.id = $2 AND order_line.id = $3`, [c.organizationId, line.sales_order_id, line.sales_order_line_id])).rows[0];
    if (!orderLine) throw invoiceError(409, "TIME_INVOICE_RATE_INVALID", `${line.label}: the order line was amended — authorize the new line before billing.`);
    if (line.hourly_rate === null || Number(orderLine.unit_price) !== Number(line.hourly_rate)) throw invoiceError(409, "TIME_INVOICE_RATE_INVALID", `${line.label}: the order's rate (${orderLine.unit_price}) differs from the authorized ${line.hourly_rate}.`);
    if (group.minutes % line.rounding_minutes !== 0) throw invoiceError(400, "TIME_INVOICE_INPUT_INVALID", `${line.label} bills in steps of ${line.rounding_minutes} minutes.`);
    if (line.max_minutes !== null) {
      const used = Number((await client.query(`SELECT COALESCE(sum(allocated_minutes), 0)::int AS n FROM tenant.project_time_billing_allocations WHERE contract_line_id = $1 AND status <> 'REVERSED'`, [line.id])).rows[0].n);
      if (used + group.minutes > line.max_minutes) throw invoiceError(409, "TIME_INVOICE_CONTRACT_CAP_EXCEEDED", `${line.label} allows ${minutesLabel(line.max_minutes)}; ${minutesLabel(Math.max(line.max_minutes - used, 0))} remain.`);
    }
    plan.push({ ...group, line, orderLineId: orderLine.id, hours: hoursOf(group.minutes), rate: String(line.hourly_rate), currency: line.currency, amount: String(amountFor(group.minutes, line.hourly_rate)),
      description: `${line.label} — ${hoursOf(group.minutes)} hours × ${line.currency} ${line.hourly_rate}` });
  }
  return { orderId, plan };
}

// What the Sales invoice engine would put on the draft: the order's prices and the tax engine's components. Nothing is saved.
async function salesFigures(client, c, orderId, plan, invoiceDate) {
  const order = (await client.query(`SELECT * FROM tenant.sales_orders WHERE organization_id = $1 AND id = $2`, [c.organizationId, orderId])).rows[0];
  const basis = (await client.query(`SELECT invoice_quantity_basis FROM tenant.sales_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]?.invoice_quantity_basis ?? "ordered";
  const lines = await invoiceableLines(client, c.organizationId, order, basis === "delivered" ? "delivered" : "ordered");
  const byId = new Map(lines.map((line) => [line.lineId, line]));
  const source = await orderSource(client, c.organizationId, order.current_version_id);
  const chosen = [];
  for (const row of plan) {
    const line = byId.get(row.orderLineId);
    if (!line) throw invoiceError(409, "TIME_INVOICE_CONTRACT_MISSING");
    if (Number(row.hours) > Number(line.remainingToInvoice) + 1e-9) throw invoiceError(409, "TIME_INVOICE_CONTRACT_CAP_EXCEEDED", `${row.line.label}: the order has ${line.remainingToInvoice} h left to invoice.`);
    chosen.push({ line, quantity: Number(row.hours) });
  }
  let built;
  try {
    const taxOf = await taxEngineFor(client, c, { ...source.version, invoice_date: invoiceDate });
    built = await buildInvoiceLines(client, c, source, chosen, taxOf);
  } catch (failure) {
    if (failure?.name === "TaxError" || /tax/i.test(failure?.message ?? "")) throw invoiceError(409, "TIME_INVOICE_TAX_VALIDATION", failure.message);
    throw failure;
  }
  return { order, built };
}
const periodOpen = async (client, c, day) => {
  const period = (await client.query(`SELECT status, locked_at FROM tenant.fiscal_periods WHERE organization_id = $1 AND start_date <= $2::date AND end_date >= $2::date ORDER BY start_date DESC LIMIT 1`,
    [c.organizationId, day])).rows[0];
  if (period && (period.locked_at || !["open"].includes(String(period.status).toLowerCase()))) throw invoiceError(409, "TIME_INVOICE_PERIOD_CLOSED");
};

// input: { entries: [{ entryId, minutes?, expectedVersion? }], invoiceDate? } — the invoice the selection would make. Saves nothing.
export async function previewInvoiceFromTime(client, c, projectId, input = {}) {
  const project = await loadProjectRow(client, c, projectId);
  if (!viewsBilling(c)) throw invoiceError(403, "TIME_INVOICE_PERMISSION_DENIED");
  if (project.status === "DRAFT") throw invoiceError(409, "TIME_INVOICE_NO_ELIGIBLE_TIME", "A draft project has no billable time.");
  const { orderId, plan } = await planOf(client, c, project, input.entries).catch((failure) => { throw translate(failure); });
  const invoiceDate = input.invoiceDate ? isoDay(input.invoiceDate) : await companyDay(client, c);
  const { order, built } = await salesFigures(client, c, orderId, plan, invoiceDate);
  const lines = plan.map((row, index) => {
    const figures = built[index];
    const gross = Number(figures.sales.gross_amount);
    const discount = Number(figures.finance.discountAmount);
    return { contractLineId: row.contractLineId, label: row.line.label, description: row.description, minutes: row.minutes, hours: row.hours, rate: row.rate, currency: row.currency,
      taxable: (gross - discount).toFixed(2), tax: figures.finance.taxAmount, taxes: figures.taxes.map((tax) => ({ label: tax.label, rate: String(tax.rate), amount: String(tax.taxAmount) })),
      entries: row.entries };
  });
  const taxable = lines.reduce((sum, line) => sum + Number(line.taxable), 0);
  const tax = lines.reduce((sum, line) => sum + Number(line.tax), 0);
  return { projectId: project.id, salesOrderId: order.id, salesOrder: order.sales_order_number, invoiceDate, currency: plan[0].currency, lines,
    totals: { minutes: plan.reduce((sum, row) => sum + row.minutes, 0), taxable: taxable.toFixed(2), tax: tax.toFixed(2), total: (taxable + tax).toFixed(2) },
    note: "Tax shown by the Sales tax engine for this order; the issued invoice's figures are Sales'." };
}

// ------------------------------------------------------------------ prepare: reserve and create the Sales Invoice Draft
// input: { entries: [{ entryId, minutes?, expectedVersion? }], invoiceDate?, billingPeriodStart?, billingPeriodEnd?, note?, idempotencyKey } — reserves the
// minutes in one billing request per contract line, sends them to Sales (the creator must be allowed to authorize billing when the company
// asks for it) and creates one Sales Invoice Draft. A retry with the same key returns the same draft.
export async function createInvoiceFromTime(client, c, projectId, input = {}) {
  const key = keyOf(input);
  if (!key) throw invoiceError(400, "TIME_INVOICE_INPUT_INVALID", "A request key is required.");
  const done = (await client.query(`SELECT request.id, request.draft_invoice_id, invoice.invoice_number FROM tenant.project_time_billing_requests request
      LEFT JOIN tenant.accounting_customer_invoices invoice ON invoice.id = request.draft_invoice_id WHERE request.organization_id = $1 AND request.draft_key = $2`, [c.organizationId, key])).rows;
  if (done.length) return { invoiceId: done[0].draft_invoice_id, invoiceNumber: done[0].invoice_number, requestIds: done.map((row) => row.id), replayed: true };
  const project = await loadProjectRow(client, c, projectId);
  if (!mayRequest(c, project)) throw invoiceError(403, "TIME_INVOICE_PERMISSION_DENIED");
  if (!salesMay(c, "sales.invoice.request")) throw invoiceError(403, "TIME_INVOICE_PERMISSION_DENIED", "Creating the Sales Invoice Draft needs the Sales permission to create invoices.");
  const settings = await billingSettings(client, c);
  if (settings.requestApproval && !mayAuthorize(c)) throw invoiceError(403, "TIME_INVOICE_PERMISSION_DENIED", "Your company asks billing to be authorized: reserve the time and let an authorizer send it to Sales.");
  if (project.status === "DRAFT") throw invoiceError(409, "TIME_INVOICE_NO_ELIGIBLE_TIME", "A draft project has no billable time.");
  const { plan } = await planOf(client, c, project, input.entries).catch((failure) => { throw translate(failure); });
  const requestIds = [];
  for (const row of plan) {
    let made;
    try {
      made = await createTimeBillingRequest(client, c, project.id, { entries: row.entries.map((entry) => ({ entryId: entry.entryId, minutes: entry.minutes })), contractLineId: row.contractLineId,
        note: text(input.note, 1000) || null, idempotencyKey: `${key}:${row.contractLineId}` });
    } catch (failure) { throw translate(failure); }
    await client.query(`UPDATE tenant.project_time_billing_requests SET status = 'SUBMITTED', submitted_by = $3, submitted_at = now(), row_version = row_version + 1 WHERE organization_id = $1 AND id = $2 AND status = 'DRAFT'`,
      [c.organizationId, made.requestId, c.userId ?? null]);
    requestIds.push(made.requestId);
  }
  return draftFromRequests(client, c, project, requestIds, { ...input, idempotencyKey: key });
}
// Billing requests already sent to Sales (by an authorizer) made into one Sales Invoice Draft by a Sales user. input: { requestIds, invoiceDate?, idempotencyKey }
export async function createSalesInvoiceDraftFromTime(client, c, input = {}) {
  const key = keyOf(input);
  if (!key) throw invoiceError(400, "TIME_INVOICE_INPUT_INVALID", "A request key is required.");
  const done = (await client.query(`SELECT request.id, request.draft_invoice_id, invoice.invoice_number FROM tenant.project_time_billing_requests request
      LEFT JOIN tenant.accounting_customer_invoices invoice ON invoice.id = request.draft_invoice_id WHERE request.organization_id = $1 AND request.draft_key = $2`, [c.organizationId, key])).rows;
  if (done.length) return { invoiceId: done[0].draft_invoice_id, invoiceNumber: done[0].invoice_number, requestIds: done.map((row) => row.id), replayed: true };
  if (!salesMay(c, "sales.invoice.request")) throw invoiceError(403, "TIME_INVOICE_PERMISSION_DENIED");
  const ids = [...new Set((Array.isArray(input.requestIds) ? input.requestIds : []).map((id) => uuid(id, "Billing request")))];
  if (!ids.length) throw invoiceError(400, "TIME_INVOICE_INPUT_INVALID", "Choose the billing requests to invoice.");
  const first = (await client.query(`SELECT project_id FROM tenant.project_time_billing_requests WHERE organization_id = $1 AND id = $2`, [c.organizationId, ids[0]])).rows[0];
  if (!first) throw invoiceError(404, "TIME_INVOICE_INPUT_INVALID", "Billing request not found.");
  const project = await loadProjectRow(client, c, first.project_id);
  return draftFromRequests(client, c, project, ids, { ...input, idempotencyKey: key });
}
async function draftFromRequests(client, c, project, requestIds, input) {
  const requests = (await client.query(`SELECT * FROM tenant.project_time_billing_requests WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`, [c.organizationId, requestIds])).rows;
  if (requests.length !== requestIds.length) throw invoiceError(404, "TIME_INVOICE_INPUT_INVALID", "A billing request was not found.");
  const groups = new Map();
  let orderId = null;
  for (const request of requests) {
    if (request.project_id !== project.id) throw invoiceError(400, "TIME_INVOICE_INPUT_INVALID", "Every request must be of the same project.");
    if (request.draft_invoice_id) throw invoiceError(409, "TIME_INVOICE_DRAFT_ALREADY_EXISTS");
    if (request.status !== "SUBMITTED") throw invoiceError(409, "TIME_INVOICE_VERSION_CONFLICT", `BR-${request.request_number} is ${request.status.toLowerCase()}; only requests sent to Sales are invoiced.`);
    const line = await loadContractLine(client, c, request.contract_line_id);
    if (!line || line.order_party_id !== project.customer_id) throw invoiceError(400, "TIME_INVOICE_CUSTOMER_MISMATCH");
    if (orderId && orderId !== line.sales_order_id) throw invoiceError(400, "TIME_INVOICE_INPUT_INVALID", "These requests bill different Sales Orders: create one draft per order.");
    orderId = line.sales_order_id;
    // The time behind a request must still be approved and eligible.
    const stale = (await client.query(`SELECT entry.entry_number FROM tenant.project_time_billing_allocations allocation JOIN tenant.project_time_entries entry ON entry.id = allocation.entry_id
        WHERE allocation.billing_request_id = $1 AND allocation.status = 'REQUESTED' AND (entry.entry_status <> 'APPROVED' OR entry.billing_classification <> 'TIME_AND_MATERIALS_ELIGIBLE')`, [request.id])).rows;
    if (stale.length) throw invoiceError(409, "TIME_INVOICE_VERSION_CONFLICT", `${stale.map((row) => `TE-${row.entry_number}`).join(", ")} changed since it was reserved.`);
    const orderLine = (await client.query(`SELECT order_line.id, order_line.unit_price FROM tenant.sales_order_lines order_line JOIN tenant.sales_orders so ON so.current_version_id = order_line.sales_order_version_id
       WHERE so.id = $1 AND order_line.id = $2`, [line.sales_order_id, line.sales_order_line_id])).rows[0];
    if (!orderLine || Number(orderLine.unit_price) !== Number(request.hourly_rate)) throw invoiceError(409, "TIME_INVOICE_RATE_INVALID", `BR-${request.request_number}: the order's rate no longer matches the rate the time was reserved at.`);
    const group = groups.get(orderLine.id) ?? { orderLineId: orderLine.id, minutes: 0, requests: [] };
    group.minutes += request.total_minutes - request.credited_minutes;
    group.requests.push(request);
    groups.set(orderLine.id, group);
  }
  const invoiceDate = input.invoiceDate ? isoDay(input.invoiceDate) : await companyDay(client, c);
  await periodOpen(client, c, invoiceDate);
  let created;
  try {
    created = await createInvoiceFromSalesOrder(client, c, orderId, {
      idempotencyKey: `project-time:${input.idempotencyKey}`, invoiceDate, lines: [...groups.values()].map((group) => ({ salesOrderLineId: group.orderLineId, quantity: Number(hoursOf(group.minutes)) })),
      internalNotes: `From ${project.project_code} approved time: ${requests.map((request) => `BR-${request.request_number}`).join(", ")}`,
    });
  } catch (failure) {
    if (failure?.code === "SALES_ORDER_INVOICE_EXCEEDS_REMAINING") throw invoiceError(409, "TIME_INVOICE_CONTRACT_CAP_EXCEEDED", failure.message);
    if (failure?.code === "PERMISSION_DENIED") throw invoiceError(403, "TIME_INVOICE_PERMISSION_DENIED", failure.message);
    throw failure;
  }
  const lines = (await client.query(`SELECT id, source_sales_order_line_id FROM tenant.accounting_customer_invoice_lines WHERE organization_id = $1 AND customer_invoice_id = $2`, [c.organizationId, created.invoiceId])).rows;
  for (const group of groups.values()) {
    const line = lines.find((row) => row.source_sales_order_line_id === group.orderLineId);
    for (const request of group.requests) {
      await client.query(`UPDATE tenant.project_time_billing_requests SET draft_invoice_id = $3, draft_invoice_line_id = $4, draft_created_by = $5, draft_created_at = now(), draft_key = $6, sales_order_id = $7,
          billing_period_start = $8::date, billing_period_end = $9::date, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, request.id, created.invoiceId, line?.id ?? null, c.userId ?? null, input.idempotencyKey, orderId, input.billingPeriodStart ? isoDay(input.billingPeriodStart) : null,
        input.billingPeriodEnd ? isoDay(input.billingPeriodEnd) : null]);
    }
  }
  const minutes = [...groups.values()].reduce((sum, group) => sum + group.minutes, 0);
  await projectEvent(client, c, project.id, "TIME_INVOICE_DRAFTED", `${created.invoiceNumber}: Sales Invoice Draft for ${minutesLabel(minutes)} of approved time (${requests.map((request) => `BR-${request.request_number}`).join(", ")})`);
  return { invoiceId: created.invoiceId, invoiceNumber: created.invoiceNumber, status: "draft", requestIds: requests.map((request) => request.id), minutes };
}

// ------------------------------------------------------------------ read back from Sales
// The draft's line for each request, found by the order line its contract line bills (Sales replaces draft lines when it posts).
async function linesFor(client, c, invoiceId, requests) {
  const lines = (await client.query(`SELECT id, quantity, net_amount, source_sales_order_line_id FROM tenant.accounting_customer_invoice_lines WHERE organization_id = $1 AND customer_invoice_id = $2`,
    [c.organizationId, invoiceId])).rows;
  const orderLine = new Map((await client.query(`SELECT id, sales_order_line_id FROM tenant.project_time_contract_lines WHERE id = ANY($1::uuid[])`, [requests.map((request) => request.contract_line_id)])).rows
    .map((row) => [row.id, row.sales_order_line_id]));
  for (const request of requests) request.line = lines.find((line) => line.source_sales_order_line_id === orderLine.get(request.contract_line_id)) ?? null;
  return lines;
}
// The draft was posted (the minutes become invoiced, once), cancelled (they are released) or edited (its time-linked hours must stay what
// was reserved). Runs inside Sales' own transaction, so the invoice and the minutes never disagree.
async function onInvoice(client, context, { invoiceId, eventType }) {
  if (!["sales_invoice.posted", "sales_invoice.submitted_for_approval", "sales_invoice.cancelled", "sales_invoice.updated"].includes(eventType)) return;
  const requests = (await client.query(`SELECT * FROM tenant.project_time_billing_requests WHERE organization_id = $1 AND draft_invoice_id = $2 AND status = 'SUBMITTED' FOR UPDATE`, [context.organizationId, invoiceId])).rows;
  if (!requests.length) return;
  if (eventType === "sales_invoice.cancelled") return releaseDraft(client, context, requests, "Sales cancelled the draft invoice");
  // The time-linked lines bill exactly the reserved hours: a change there goes through the project (cancel the draft and prepare again).
  const lines = await linesFor(client, context, invoiceId, requests);
  const byLine = new Map();
  for (const request of requests) {
    if (!request.line) throw invoiceError(409, "TIME_INVOICE_VERSION_CONFLICT", `The line billing BR-${request.request_number}'s approved time was removed. Cancel this draft and prepare it again from the project.`);
    byLine.set(request.line.id, (byLine.get(request.line.id) ?? 0) + request.total_minutes - request.credited_minutes);
  }
  for (const [lineId, minutes] of byLine) {
    const line = lines.find((row) => row.id === lineId);
    if (Math.abs(Number(line.quantity) * 60 - minutes) >= 0.5) {
      throw invoiceError(409, "TIME_INVOICE_VERSION_CONFLICT", `A line billing approved project time must stay ${hoursOf(minutes)} hours. Cancel this draft and prepare it again from the project to change the time.`);
    }
  }
  if (eventType === "sales_invoice.updated") return;
  const invoice = (await client.query(`SELECT status, invoice_number FROM tenant.accounting_customer_invoices WHERE id = $1`, [invoiceId])).rows[0];
  if (CONFIRMED.includes(invoice.status)) await markInvoiced(client, context, requests, invoiceId, lines, invoice.invoice_number);
}
registerInvoiceLifecycleListener(onInvoice);
async function markInvoiced(client, c, requests, invoiceId, lines, invoiceNumber) {
  if (requests.some((request) => request.line === undefined)) await linesFor(client, c, invoiceId, requests);
  for (const request of requests) {
    const line = request.line;
    if (!line) continue;
    const lineMinutes = requests.filter((other) => other.line?.id === line.id).reduce((sum, other) => sum + other.total_minutes - other.credited_minutes, 0);
    const share = line ? (Number(line.net_amount) * (request.total_minutes - request.credited_minutes) / lineMinutes).toFixed(2) : null;
    await client.query(`UPDATE tenant.project_time_billing_allocations SET status = 'INVOICED', customer_invoice_id = $3, customer_invoice_line_id = $4, invoiced_by = $5, invoiced_at = now()
        WHERE organization_id = $1 AND billing_request_id = $2 AND status = 'REQUESTED'`, [c.organizationId, request.id, invoiceId, line.id, c.userId ?? null]);
    await client.query(`UPDATE tenant.project_time_billing_requests SET status = 'INVOICED', customer_invoice_id = $3, customer_invoice_line_id = $4, draft_invoice_line_id = $4, invoiced_amount = $5, invoiced_by = $6,
        invoiced_at = now(), row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, request.id, invoiceId, line.id, share, c.userId ?? null]);
    await projectEvent(client, c, request.project_id, "TIME_INVOICED", `BR-${request.request_number}: ${minutesLabel(request.total_minutes)} invoiced on ${invoiceNumber}`);
    if (request.created_by) {
      await createNotification(client, { organizationId: c.organizationId, userId: request.created_by, category: "project_timesheet", title: `BR-${request.request_number} invoiced`,
        message: `${minutesLabel(request.total_minutes)} of approved time is on ${invoiceNumber}.`, href: `/projects/${request.project_id}?tab=financials`, entityType: "projects.time_billing_request", entityId: request.id });
    }
  }
}
async function releaseDraft(client, c, requests, reason) {
  for (const request of requests) {
    await client.query(`UPDATE tenant.project_time_billing_allocations SET status = 'REVERSED', reversal_kind = 'RELEASED', reversed_by = $3, reversed_at = now(), reversal_reason = $4
        WHERE organization_id = $1 AND billing_request_id = $2 AND status = 'REQUESTED'`, [c.organizationId, request.id, c.userId ?? null, reason]);
    await client.query(`UPDATE tenant.project_time_billing_requests SET status = 'CANCELLED', cancelled_by = $3, cancelled_at = now(), cancel_reason = $4, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, request.id, c.userId ?? null, reason]);
    await projectEvent(client, c, request.project_id, "TIME_BILLING_CANCELLED", `BR-${request.request_number}: ${reason}; ${minutesLabel(request.total_minutes)} released`);
  }
}
// The reconciler: drafts posted or cancelled through another path (a Finance approval, say) are read back now. Never creates or frees
// anything Sales has not decided. input: { projectId? }
export async function reconcileTimeInvoices(client, c, input = {}) {
  if (!viewsBilling(c)) throw invoiceError(403, "TIME_INVOICE_PERMISSION_DENIED");
  const rows = (await client.query(`SELECT request.*, invoice.status AS invoice_status, invoice.invoice_number FROM tenant.project_time_billing_requests request
      JOIN tenant.accounting_customer_invoices invoice ON invoice.id = request.draft_invoice_id
     WHERE request.organization_id = $1 AND request.status = 'SUBMITTED' AND ($2::uuid IS NULL OR request.project_id = $2) FOR UPDATE OF request`,
  [c.organizationId, input.projectId ? uuid(input.projectId, "Project") : null])).rows;
  const byInvoice = new Map();
  for (const row of rows) byInvoice.set(row.draft_invoice_id, [...(byInvoice.get(row.draft_invoice_id) ?? []), row]);
  let invoiced = 0;
  let released = 0;
  for (const [invoiceId, requests] of byInvoice) {
    const status = requests[0].invoice_status;
    if (status === "cancelled") { await releaseDraft(client, c, requests, `Sales cancelled ${requests[0].invoice_number}`); released += requests.length; }
    else if (CONFIRMED.includes(status)) {
      const lines = await linesFor(client, c, invoiceId, requests);
      await markInvoiced(client, c, requests, invoiceId, lines, requests[0].invoice_number); invoiced += requests.length;
    }
  }
  return { checked: rows.length, invoiced, released };
}

// ------------------------------------------------------------------ after issue: reversal and credit
// input: { documentId (the reversed invoice or the credit note), minutes?, disposition: REBILLABLE | NOT_REBILLABLE, reason } — an authorized
// decision about invoiced minutes. Rebillable minutes are reversed and become available; not rebillable (a price concession) leaves them consumed.
export async function recordTimeBillingDisposition(client, c, requestId, input = {}) {
  if (!mayAuthorize(c)) throw invoiceError(403, "TIME_INVOICE_PERMISSION_DENIED");
  const request = (await client.query(`SELECT * FROM tenant.project_time_billing_requests WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(requestId, "Billing request")])).rows[0];
  if (!request) throw invoiceError(404, "TIME_INVOICE_INPUT_INVALID", "Billing request not found.");
  if (request.status !== "INVOICED") throw invoiceError(409, "TIME_INVOICE_VERSION_CONFLICT", "Only invoiced time is adjusted.");
  const disposition = String(input.disposition ?? "").toUpperCase();
  if (!["REBILLABLE", "NOT_REBILLABLE"].includes(disposition)) throw invoiceError(400, "TIME_INVOICE_INPUT_INVALID", "Decide whether the credited time may be billed again.", { field: "disposition" });
  const reason = text(input.reason, 500);
  if (reason.length < 3) throw invoiceError(400, "TIME_INVOICE_INPUT_INVALID", "Say why.", { field: "reason" });
  const document = (await client.query(`SELECT id, invoice_number, invoice_type, status, source_invoice_id FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, uuid(input.documentId, "Document")])).rows[0];
  let kind;
  if (document?.id === request.customer_invoice_id && ["reversed", "cancelled"].includes(document.status)) kind = document.status === "reversed" ? "INVOICE_REVERSED" : "INVOICE_CANCELLED";
  else if (document?.invoice_type === "credit_note" && document.source_invoice_id === request.customer_invoice_id && !["draft", "cancelled", "pending_approval"].includes(document.status)) kind = "CREDIT_NOTE";
  else throw invoiceError(409, "TIME_INVOICE_INPUT_INVALID", "Choose the reversed invoice, or an issued credit note against it.", { field: "documentId" });
  if ((await client.query(`SELECT 1 FROM tenant.project_time_billing_adjustments WHERE billing_request_id = $1 AND document_id = $2`, [request.id, document.id])).rows[0]) {
    return { requestId: request.id, status: request.status, replayed: true };
  }
  const active = (await client.query(`SELECT * FROM tenant.project_time_billing_allocations WHERE organization_id = $1 AND billing_request_id = $2 AND status = 'INVOICED' ORDER BY allocated_minutes DESC, id FOR UPDATE`,
    [c.organizationId, request.id])).rows;
  const open = active.reduce((sum, row) => sum + row.allocated_minutes, 0);
  const minutes = kind === "CREDIT_NOTE" && input.minutes !== undefined && input.minutes !== null ? Number(input.minutes) : open;
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > open) throw invoiceError(400, "TIME_INVOICE_QUANTITY_EXCEEDED", `Between 1 minute and the ${minutesLabel(open)} still invoiced.`);
  await client.query(`INSERT INTO tenant.project_time_billing_adjustments (organization_id, billing_request_id, project_id, document_kind, document_id, document_number, minutes, disposition, reason, decided_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [c.organizationId, request.id, request.project_id, kind, document.id, document.invoice_number, minutes, disposition, reason, c.userId ?? null]);
  let status = request.status;
  if (disposition === "REBILLABLE") {
    let left = minutes;
    for (const allocation of active) {
      if (left <= 0) break;
      await client.query(`UPDATE tenant.project_time_billing_allocations SET status = 'REVERSED', reversal_kind = $3, reversed_by = $4, reversed_at = now(), reversal_reason = $5, reversal_reference = $6
          WHERE organization_id = $1 AND id = $2`, [c.organizationId, allocation.id, kind === "CREDIT_NOTE" ? "CREDITED" : "INVOICE_CANCELLED", c.userId ?? null, reason, document.invoice_number]);
      const kept = allocation.allocated_minutes - Math.min(left, allocation.allocated_minutes);
      if (kept > 0) {
        await client.query(`INSERT INTO tenant.project_time_billing_allocations (organization_id, entry_id, project_id, billing_request_id, allocated_minutes, status, contract_line_id, hourly_rate, currency,
              customer_invoice_id, customer_invoice_line_id, requested_by, requested_at, invoiced_by, invoiced_at) VALUES ($1,$2,$3,$4,$5,'INVOICED',$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [c.organizationId, allocation.entry_id, allocation.project_id, request.id, kept, allocation.contract_line_id, allocation.hourly_rate, allocation.currency, allocation.customer_invoice_id,
          allocation.customer_invoice_line_id, allocation.requested_by, allocation.requested_at, allocation.invoiced_by, allocation.invoiced_at]);
      }
      left -= Math.min(left, allocation.allocated_minutes);
    }
    const credited = request.credited_minutes + minutes;
    status = credited >= request.total_minutes ? "REVERSED" : "INVOICED";
    await client.query(`UPDATE tenant.project_time_billing_requests SET credited_minutes = $3, status = $4, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, request.id, credited, status]);
  }
  await projectEvent(client, c, request.project_id, "TIME_BILLING_ADJUSTED", `BR-${request.request_number}: ${minutesLabel(minutes)} ${disposition === "REBILLABLE" ? "available to bill again" : "stay invoiced (no rebilling)"} after ${document.invoice_number} — ${reason}`);
  return { requestId: request.id, status, minutes, disposition };
}

// ------------------------------------------------------------------ the project's billing from time
export async function getProjectTimeInvoiceSummary(client, c, projectId) {
  const project = await loadProjectRow(client, c, projectId);
  if (!viewsBilling(c)) throw invoiceError(403, "TIME_INVOICE_PERMISSION_DENIED");
  const eligible = await getInvoiceEligibleProjectTime(client, c, project.id, { all: true });
  const draftMinutes = Number((await client.query(`SELECT COALESCE(sum(allocation.allocated_minutes), 0)::int AS n FROM tenant.project_time_billing_allocations allocation
      JOIN tenant.project_time_billing_requests request ON request.id = allocation.billing_request_id WHERE allocation.project_id = $1 AND allocation.status = 'REQUESTED' AND request.draft_invoice_id IS NOT NULL`, [project.id])).rows[0].n);
  const invoices = (await client.query(`SELECT invoice.id, invoice.invoice_number, invoice.status, to_char(invoice.invoice_date, 'YYYY-MM-DD') AS invoice_date, invoice.grand_total, invoice.outstanding_amount, btrim(invoice.currency_code) AS currency,
        sum(request.total_minutes - request.credited_minutes)::int AS minutes, string_agg('BR-' || request.request_number, ', ' ORDER BY request.request_number) AS requests,
        bool_or(request.status = 'SUBMITTED') AS draft
      FROM tenant.project_time_billing_requests request JOIN tenant.accounting_customer_invoices invoice ON invoice.id = COALESCE(request.customer_invoice_id, request.draft_invoice_id)
     WHERE request.organization_id = $1 AND request.project_id = $2 GROUP BY invoice.id ORDER BY invoice.invoice_date DESC NULLS LAST`, [c.organizationId, project.id])).rows;
  const finance = has(c, "accounting.view") || has(c, "sales.invoice.view_all") || seesAll(c);
  const exceptions = await getTimeInvoiceExceptions(client, c, { projectId: project.id });
  const t = eligible.totals;
  return {
    projectId: project.id, measure: "Billing coverage is a time-quantity measure, not revenue.",
    totals: { approvedEligibleMinutes: t.approvedMinutes, invoicedMinutes: t.invoicedMinutes, reservedMinutes: t.reservedMinutes - draftMinutes, inDraftMinutes: draftMinutes, availableMinutes: t.availableMinutes,
      coverage: t.approvedMinutes ? Math.floor((t.invoicedMinutes * 1000) / t.approvedMinutes) / 10 : null },
    contractLines: eligible.contractLines,
    invoices: invoices.map((row) => ({ id: row.id, number: row.invoice_number, status: row.status, draft: Boolean(row.draft) && row.status === "draft", date: row.invoice_date, minutes: row.minutes, requests: row.requests,
      currency: row.currency, ...(finance ? { total: String(row.grand_total), outstanding: row.outstanding_amount === null ? null : String(row.outstanding_amount) } : {}), href: `/sales/invoices/${row.id}` })),
    exceptions: exceptions.length,
    can: { request: mayRequest(c, project), authorize: mayAuthorize(c), draft: mayRequest(c, project) && has(c, "sales.invoice.request") && (!(await billingSettings(client, c)).requestApproval || mayAuthorize(c)),
      salesDraft: has(c, "sales.invoice.request") },
  };
}
// The billing exception queue: what needs a person. filters: { projectId? }
export async function getTimeInvoiceExceptions(client, c, filters = {}) {
  if (!viewsBilling(c)) throw invoiceError(403, "TIME_INVOICE_PERMISSION_DENIED");
  const values = [c.organizationId, c.userId ?? null, filters.projectId ? uuid(filters.projectId, "Project") : null];
  const scope = `${visibilitySql(c, "project", "$2")} AND ($3::uuid IS NULL OR project.id = $3)`;
  const q = async (sql) => (await client.query(sql, values)).rows;
  const out = [];
  for (const row of await q(`SELECT request.id, request.request_number, project.project_code, invoice.invoice_number, invoice.status FROM tenant.project_time_billing_requests request JOIN tenant.projects project ON project.id = request.project_id
      JOIN tenant.accounting_customer_invoices invoice ON invoice.id = request.draft_invoice_id WHERE request.organization_id = $1 AND ${scope} AND request.status = 'SUBMITTED' AND invoice.status <> 'draft'`)) {
    out.push({ kind: "DRAFT_OUTCOME", requestId: row.id, label: `BR-${row.request_number} · ${row.project_code}`, message: `${row.invoice_number} is ${row.status.replace(/_/g, " ")} in Sales — reconcile to record it.` });
  }
  for (const row of await q(`SELECT request.id, request.request_number, project.project_code, invoice.id AS invoice_id, invoice.invoice_number, invoice.status FROM tenant.project_time_billing_requests request JOIN tenant.projects project ON project.id = request.project_id
      JOIN tenant.accounting_customer_invoices invoice ON invoice.id = request.customer_invoice_id WHERE request.organization_id = $1 AND ${scope} AND request.status = 'INVOICED' AND invoice.status IN ('reversed', 'cancelled')
        AND NOT EXISTS (SELECT 1 FROM tenant.project_time_billing_adjustments adjustment WHERE adjustment.billing_request_id = request.id AND adjustment.document_id = invoice.id)`)) {
    out.push({ kind: "INVOICE_REVERSED", requestId: row.id, documentId: row.invoice_id, label: `BR-${row.request_number} · ${row.project_code}`, message: `${row.invoice_number} was ${row.status}: decide whether its time may be billed again.` });
  }
  for (const row of await q(`SELECT request.id, request.request_number, project.project_code, note.id AS note_id, note.invoice_number FROM tenant.project_time_billing_requests request JOIN tenant.projects project ON project.id = request.project_id
      JOIN tenant.accounting_customer_invoices note ON note.source_invoice_id = request.customer_invoice_id AND note.invoice_type = 'credit_note' AND note.status NOT IN ('draft', 'cancelled', 'pending_approval')
     WHERE request.organization_id = $1 AND ${scope} AND request.status = 'INVOICED'
       AND NOT EXISTS (SELECT 1 FROM tenant.project_time_billing_adjustments adjustment WHERE adjustment.billing_request_id = request.id AND adjustment.document_id = note.id)`)) {
    out.push({ kind: "CREDIT_NOTE", requestId: row.id, documentId: row.note_id, label: `BR-${row.request_number} · ${row.project_code}`, message: `Credit note ${row.invoice_number} was issued: decide whether the time may be billed again (it is not by default).` });
  }
  for (const row of await q(`SELECT DISTINCT entry.id, entry.entry_number, project.project_code, entry.entry_status FROM tenant.project_time_billing_allocations allocation JOIN tenant.project_time_entries entry ON entry.id = allocation.entry_id
      JOIN tenant.projects project ON project.id = allocation.project_id WHERE allocation.organization_id = $1 AND ${scope} AND allocation.status IN ('REQUESTED', 'INVOICED')
        AND (entry.entry_status <> 'APPROVED' OR entry.billing_classification <> 'TIME_AND_MATERIALS_ELIGIBLE')`)) {
    out.push({ kind: "SOURCE_CHANGED", entryId: row.id, label: `TE-${row.entry_number} · ${row.project_code}`, message: `The time entry is ${row.entry_status.toLowerCase().replace(/_/g, " ")} or no longer billable after it was reserved or invoiced — review the billing with Sales.` });
  }
  for (const row of await q(`SELECT request.id, request.request_number, project.project_code, invoice.invoice_number FROM tenant.project_time_billing_requests request JOIN tenant.projects project ON project.id = request.project_id
      JOIN tenant.accounting_customer_invoices invoice ON invoice.id = request.draft_invoice_id WHERE request.organization_id = $1 AND ${scope} AND request.status = 'SUBMITTED' AND invoice.status = 'draft' AND request.draft_created_at < now() - interval '14 days'`)) {
    out.push({ kind: "STALE_DRAFT", requestId: row.id, label: `BR-${row.request_number} · ${row.project_code}`, message: `${row.invoice_number} has waited as a draft for over two weeks; its time stays reserved.` });
  }
  return out;
}

// ------------------------------------------------------------------ reports
export const TIME_INVOICE_REPORTS = Object.freeze(["unbilled", "reserved", "invoiced-by-project", "by-customer", "by-service", "by-period", "partially-invoiced", "drafts", "contract-allowance", "rate-history",
  "adjustments", "duplicate-exceptions", "reconciliation", "traceability"]);
export async function getTimeInvoiceReport(client, c, kind = "unbilled", filters = {}) {
  if (!TIME_INVOICE_REPORTS.includes(kind)) throw invoiceError(400, "TIME_INVOICE_INPUT_INVALID", "Unknown report.");
  if (!viewsBilling(c)) throw invoiceError(403, "TIME_INVOICE_PERMISSION_DENIED");
  const values = [c.organizationId, c.userId ?? null, filters.projectId ? uuid(filters.projectId, "Project") : null];
  const scope = `${visibilitySql(c, "project", "$2")} AND ($3::uuid IS NULL OR project.id = $3)`;
  const q = async (sql) => (await client.query(sql, values)).rows;
  const ALLOC = `FROM tenant.project_time_billing_allocations allocation JOIN tenant.projects project ON project.id = allocation.project_id JOIN tenant.project_time_contract_lines line ON line.id = allocation.contract_line_id
    LEFT JOIN tenant.business_parties party ON party.id = project.customer_id WHERE allocation.organization_id = $1 AND ${scope}`;
  switch (kind) {
    case "unbilled": case "partially-invoiced": {
      const rows = await q(`SELECT entry.id, entry.entry_number, project.project_code, to_char(entry.work_date, 'YYYY-MM-DD') AS work_date, entry.duration_minutes,
          COALESCE((SELECT sum(a.allocated_minutes) FILTER (WHERE a.status = 'INVOICED') FROM tenant.project_time_billing_allocations a WHERE a.entry_id = entry.id), 0)::int AS invoiced,
          COALESCE((SELECT sum(a.allocated_minutes) FILTER (WHERE a.status = 'REQUESTED') FROM tenant.project_time_billing_allocations a WHERE a.entry_id = entry.id), 0)::int AS reserved
         FROM tenant.project_time_entries entry JOIN tenant.projects project ON project.id = entry.project_id WHERE entry.organization_id = $1 AND ${scope} AND entry.entry_status = 'APPROVED'
           AND entry.billing_classification = 'TIME_AND_MATERIALS_ELIGIBLE' ORDER BY entry.work_date`);
      return rows.map((row) => ({ ...row, available: row.duration_minutes - row.invoiced - row.reserved }))
        .filter((row) => (kind === "unbilled" ? row.available > 0 : row.invoiced > 0 && row.invoiced < row.duration_minutes));
    }
    case "reserved": return q(`SELECT request.id, 'BR-' || request.request_number AS request, project.project_code, request.status, request.total_minutes AS minutes, invoice.invoice_number AS draft
        FROM tenant.project_time_billing_requests request JOIN tenant.projects project ON project.id = request.project_id LEFT JOIN tenant.accounting_customer_invoices invoice ON invoice.id = request.draft_invoice_id
       WHERE request.organization_id = $1 AND ${scope} AND request.status IN ('DRAFT', 'SUBMITTED') ORDER BY request.created_at`);
    case "invoiced-by-project": return q(`SELECT project.id, project.project_code, project.name, sum(allocation.allocated_minutes)::int AS minutes ${ALLOC} AND allocation.status = 'INVOICED' GROUP BY project.id ORDER BY minutes DESC`);
    case "by-customer": return q(`SELECT party.id, party.display_name AS customer, sum(allocation.allocated_minutes)::int AS minutes, count(DISTINCT allocation.customer_invoice_id)::int AS invoices ${ALLOC} AND allocation.status = 'INVOICED'
        GROUP BY party.id ORDER BY minutes DESC`);
    case "by-service": return q(`SELECT line.id, line.label AS service, line.hourly_rate AS rate, line.currency, sum(allocation.allocated_minutes)::int AS minutes ${ALLOC} AND allocation.status = 'INVOICED' GROUP BY line.id ORDER BY minutes DESC`);
    case "by-period": return q(`SELECT to_char(date_trunc('month', entry.work_date), 'YYYY-MM') AS period, sum(allocation.allocated_minutes) FILTER (WHERE allocation.status = 'INVOICED')::int AS invoiced,
        sum(allocation.allocated_minutes) FILTER (WHERE allocation.status = 'REQUESTED')::int AS reserved FROM tenant.project_time_billing_allocations allocation JOIN tenant.project_time_entries entry ON entry.id = allocation.entry_id
        JOIN tenant.projects project ON project.id = allocation.project_id WHERE allocation.organization_id = $1 AND ${scope} AND allocation.status <> 'REVERSED' GROUP BY 1 ORDER BY 1 DESC`);
    case "drafts": return q(`SELECT invoice.id, invoice.invoice_number, to_char(invoice.invoice_date, 'YYYY-MM-DD') AS invoice_date, project.project_code, sum(request.total_minutes)::int AS minutes
        FROM tenant.project_time_billing_requests request JOIN tenant.projects project ON project.id = request.project_id JOIN tenant.accounting_customer_invoices invoice ON invoice.id = request.draft_invoice_id
       WHERE request.organization_id = $1 AND ${scope} AND request.status = 'SUBMITTED' AND invoice.status = 'draft' GROUP BY invoice.id, project.project_code ORDER BY invoice.invoice_date`);
    case "contract-allowance": return q(`SELECT line.id, line.label, project.project_code, line.max_minutes, line.status,
        COALESCE((SELECT sum(a.allocated_minutes) FROM tenant.project_time_billing_allocations a WHERE a.contract_line_id = line.id AND a.status <> 'REVERSED'), 0)::int AS used
        FROM tenant.project_time_contract_lines line JOIN tenant.projects project ON project.id = line.project_id WHERE line.organization_id = $1 AND ${scope} ORDER BY project.project_code, line.line_number`);
    case "rate-history": return q(`SELECT line.id, line.label, project.project_code, line.hourly_rate, line.currency, line.status, to_char(line.effective_from, 'YYYY-MM-DD') AS effective_from, to_char(line.effective_to, 'YYYY-MM-DD') AS effective_to
        FROM tenant.project_time_contract_lines line JOIN tenant.projects project ON project.id = line.project_id WHERE line.organization_id = $1 AND ${scope} ORDER BY project.project_code, line.line_number`);
    case "adjustments": return q(`SELECT adjustment.id, 'BR-' || request.request_number AS request, project.project_code, adjustment.document_kind, adjustment.document_number, adjustment.minutes, adjustment.disposition, adjustment.reason, adjustment.decided_at
        FROM tenant.project_time_billing_adjustments adjustment JOIN tenant.project_time_billing_requests request ON request.id = adjustment.billing_request_id JOIN tenant.projects project ON project.id = adjustment.project_id
       WHERE adjustment.organization_id = $1 AND ${scope} ORDER BY adjustment.decided_at DESC`);
    case "duplicate-exceptions": return q(`SELECT entry.id, entry.entry_number, project.project_code, entry.duration_minutes, sum(allocation.allocated_minutes)::int AS claimed
        FROM tenant.project_time_billing_allocations allocation JOIN tenant.project_time_entries entry ON entry.id = allocation.entry_id JOIN tenant.projects project ON project.id = allocation.project_id
       WHERE allocation.organization_id = $1 AND ${scope} AND allocation.status <> 'REVERSED' GROUP BY entry.id, project.project_code HAVING sum(allocation.allocated_minutes) > entry.duration_minutes`);
    case "reconciliation": return (await getTimeInvoiceExceptions(client, c, filters));
    case "traceability": return q(`SELECT request.id, 'BR-' || request.request_number AS request, project.project_code, request.status, invoice.invoice_number, invoice.status AS invoice_status, line.label AS service,
        (SELECT string_agg('TE-' || entry.entry_number || ' (' || allocation.allocated_minutes || ' min)', ', ' ORDER BY entry.entry_number) FROM tenant.project_time_billing_allocations allocation
          JOIN tenant.project_time_entries entry ON entry.id = allocation.entry_id WHERE allocation.billing_request_id = request.id AND allocation.status <> 'REVERSED') AS sources
        FROM tenant.project_time_billing_requests request JOIN tenant.projects project ON project.id = request.project_id JOIN tenant.project_time_contract_lines line ON line.id = request.contract_line_id
        LEFT JOIN tenant.accounting_customer_invoices invoice ON invoice.id = COALESCE(request.customer_invoice_id, request.draft_invoice_id)
       WHERE request.organization_id = $1 AND ${scope} ORDER BY request.created_at DESC LIMIT 500`);
    default: return [];
  }
}
