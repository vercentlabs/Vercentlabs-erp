// Projects — Billable / Non-Billable Time, billing requests: approved eligible minutes are reserved in a request on one contract line (draft),
// authorized to Sales by someone allowed to (submitted), linked to the confirmed invoice line Sales billed them on (invoiced), released when a
// request is cancelled, and reversed when the invoice is cancelled or credited — in part or in full. Each minute is claimed at most once
// (entries and the contract line locked; the database checks again). A request has no ledger effect; an unknown outcome never frees minutes.
import { publishDomainEvent } from "../../../core/platform/events/index.js";
import { projectEvent, text, userNames, uuid } from "../project-core.js";
import { loadProjectRow } from "../timesheets/time-rules.js";
import { notifyTime, timeEvent } from "../timesheets/time-entries.js";
import { recordTimeBillingDisposition } from "../time-invoicing/time-invoicing.js";
import { amountFor, billError, billingSettings, keyOf, loadContractLine, mayAuthorize, mayRequest, minutesLabel } from "./billable-rules.js";

const CONFIRMED_INVOICE = ["approved", "posted", "partially_paid", "paid", "overdue", "disputed"];
const replayOf = async (client, c, key) => (key ? (await client.query(`SELECT id, status, total_minutes FROM tenant.project_time_billing_requests WHERE organization_id = $1 AND idempotency_key = $2`,
  [c.organizationId, key])).rows[0] ?? null : null);
async function lockRequest(client, c, requestId) {
  const row = (await client.query(`SELECT * FROM tenant.project_time_billing_requests WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [c.organizationId, uuid(requestId, "Billing request")])).rows[0];
  if (!row) throw billError(404, "TIME_BILLING_NOT_FOUND");
  return row;
}
const versionCheck = (row, expected) => {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(row.row_version)) throw billError(409, "TIME_BILLING_VERSION_CONFLICT");
};
const used = async (client, column, id) => Number((await client.query(`SELECT COALESCE(sum(allocated_minutes), 0)::int AS n FROM tenant.project_time_billing_allocations WHERE ${column} = $1 AND status <> 'REVERSED'`,
  [id])).rows[0].n);
const NOT_ELIGIBLE = { ELIGIBILITY_PENDING: ["TIME_BILLING_CONTRACT_MISSING", "no contract line authorizes it yet"], INCLUDED_IN_FIXED_FEE: ["TIME_BILLING_FIXED_FEE_INCLUDED", "it is included in the fixed fee"],
  NON_BILLABLE: ["TIME_BILLING_NOT_ALLOWED", "it is non-billable"] };

// input: { entries: [{ entryId, minutes? (all that is free by default) }], contractLineId?, note?, idempotencyKey? }
export async function createTimeBillingRequest(client, c, projectId, input = {}) {
  const key = keyOf(input);
  const done = await replayOf(client, c, key);
  if (done) return { requestId: done.id, status: done.status, totalMinutes: done.total_minutes, replayed: true };
  const project = await loadProjectRow(client, c, projectId);
  if (!mayRequest(c, project)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  const asked = Array.isArray(input.entries) ? input.entries : [];
  if (!asked.length) throw billError(400, "TIME_BILLING_HOURS_UNAPPROVED", "Choose the approved time to bill.");
  const ids = [...new Set(asked.map((row) => uuid(row.entryId, "Time entry")))].sort();
  if (ids.length !== asked.length) throw billError(400, "TIME_BILLING_ALREADY_ALLOCATED", "Each entry appears once in a request.");
  // Every entry locked in one order, so concurrent requests for the same time wait for each other and then see the other's claim.
  const entries = new Map((await client.query(`SELECT *, to_char(work_date, 'YYYY-MM-DD') AS work_date_text FROM tenant.project_time_entries WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
    [c.organizationId, ids])).rows.map((row) => [row.id, row]));
  const lines = new Set();
  for (const id of ids) {
    const entry = entries.get(id);
    if (!entry || entry.project_id !== project.id) throw billError(400, "TIME_BILLING_NOT_ALLOWED", "That time is not on this project.");
    if (entry.entry_status !== "APPROVED") throw billError(409, "TIME_BILLING_HOURS_UNAPPROVED", `TE-${entry.entry_number} is not approved.`);
    if (entry.billing_classification !== "TIME_AND_MATERIALS_ELIGIBLE") {
      const [code, why] = NOT_ELIGIBLE[entry.billing_classification];
      throw billError(400, code, `TE-${entry.entry_number} cannot be billed: ${why}.`);
    }
    lines.add(entry.contract_line_id);
  }
  if (lines.size !== 1) throw billError(400, "TIME_BILLING_NOT_ALLOWED", "A billing request covers one contract line; request each line separately.");
  const lineId = [...lines][0];
  if (input.contractLineId && input.contractLineId !== lineId) throw billError(400, "TIME_BILLING_CONTRACT_MISSING", "That time is classified on another contract line.");
  const line = await loadContractLine(client, c, lineId);
  await client.query(`SELECT 1 FROM tenant.project_time_contract_lines WHERE id = $1 FOR UPDATE`, [lineId]);
  if (line.order_status === "cancelled") throw billError(400, "TIME_BILLING_CONTRACT_MISSING", `${line.sales_order_number} was cancelled.`);
  if (!project.customer_id || line.order_party_id !== project.customer_id) throw billError(400, "TIME_BILLING_CUSTOMER_MISMATCH");
  if (line.hourly_rate === null) throw billError(400, "TIME_BILLING_RATE_MISSING");
  const plan = [];
  for (const ask of asked) {
    const entry = entries.get(ask.entryId);
    const free = entry.duration_minutes - await used(client, "entry_id", entry.id);
    const minutes = ask.minutes === undefined || ask.minutes === null ? free : Number(ask.minutes);
    if (free <= 0) throw billError(409, "TIME_BILLING_ALREADY_ALLOCATED", `TE-${entry.entry_number} is already reserved or invoiced in full.`);
    if (!Number.isInteger(minutes) || minutes <= 0) throw billError(400, "TIME_BILLING_LIMIT_EXCEEDED", "Bill a whole number of minutes, more than zero.");
    if (minutes > free) throw billError(409, "TIME_BILLING_ALREADY_ALLOCATED", `TE-${entry.entry_number} has ${minutesLabel(free)} free to bill.`, { entryId: entry.id, freeMinutes: free });
    if (minutes % line.rounding_minutes !== 0) throw billError(400, "TIME_BILLING_NOT_ALLOWED", `${line.label} bills in steps of ${line.rounding_minutes} minutes; ${minutesLabel(minutes)} is not one.`);
    plan.push({ entry, minutes });
  }
  const total = plan.reduce((sum, row) => sum + row.minutes, 0);
  if (line.max_minutes !== null) {
    const lineUsed = await used(client, "contract_line_id", line.id);
    if (lineUsed + total > line.max_minutes) throw billError(409, "TIME_BILLING_LIMIT_EXCEEDED", `${line.label} allows ${minutesLabel(line.max_minutes)}; ${minutesLabel(Math.max(line.max_minutes - lineUsed, 0))} remain.`,
      { remainingMinutes: Math.max(line.max_minutes - lineUsed, 0) });
  }
  const request = (await client.query(`INSERT INTO tenant.project_time_billing_requests (organization_id, project_id, customer_id, contract_line_id, total_minutes, hourly_rate, currency, estimated_amount, note, created_by, idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id, request_number`,
  [c.organizationId, project.id, project.customer_id, line.id, total, line.hourly_rate, line.currency, amountFor(total, line.hourly_rate), text(input.note, 1000) || null, c.userId ?? null, key])).rows[0];
  for (const row of plan) {
    await client.query(`INSERT INTO tenant.project_time_billing_allocations (organization_id, entry_id, project_id, billing_request_id, allocated_minutes, contract_line_id, hourly_rate, currency, requested_by, idempotency_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [c.organizationId, row.entry.id, project.id, request.id, row.minutes, line.id, line.hourly_rate, line.currency, c.userId ?? null, key]);
    await timeEvent(client, c, { projectId: project.id, employeeUserId: row.entry.employee_user_id, entryId: row.entry.id, action: "BILLING_RESERVED", summary: `${minutesLabel(row.minutes)} reserved in BR-${request.request_number}`,
      details: { billingRequestId: request.id } });
  }
  await projectEvent(client, c, project.id, "TIME_BILLING_REQUESTED", `BR-${request.request_number}: ${minutesLabel(total)} reserved on ${line.label}`);
  return { requestId: request.id, requestNumber: `BR-${request.request_number}`, status: "DRAFT", totalMinutes: total, estimatedAmount: String(amountFor(total, line.hourly_rate)), currency: line.currency };
}

// The handoff to Sales: authorized by someone who may (and, where the company asks for it, not the person who prepared the request).
export async function submitTimeBillingRequest(client, c, requestId, input = {}) {
  const request = await lockRequest(client, c, requestId);
  if (request.status === "SUBMITTED") return { requestId: request.id, status: request.status, replayed: true };
  if (request.status !== "DRAFT") throw billError(409, "TIME_BILLING_VERSION_CONFLICT", `This request is ${request.status.toLowerCase()}.`);
  versionCheck(request, input.expectedVersion);
  const project = await loadProjectRow(client, c, request.project_id);
  const settings = await billingSettings(client, c);
  if (settings.requestApproval) {
    if (!mayAuthorize(c)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED", "Someone who authorizes time billing sends it to Sales.");
    if (request.created_by === c.userId) throw billError(403, "TIME_BILLING_PERMISSION_DENIED", "Someone other than the person who prepared it authorizes the request.");
  } else if (!mayRequest(c, project) && !mayAuthorize(c)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  const stale = (await client.query(`SELECT entry.entry_number FROM tenant.project_time_billing_allocations allocation JOIN tenant.project_time_entries entry ON entry.id = allocation.entry_id
      WHERE allocation.billing_request_id = $1 AND allocation.status = 'REQUESTED' AND (entry.entry_status <> 'APPROVED' OR entry.billing_classification <> 'TIME_AND_MATERIALS_ELIGIBLE')`, [request.id])).rows;
  if (stale.length) throw billError(409, "TIME_BILLING_VERSION_CONFLICT", `${stale.map((row) => `TE-${row.entry_number}`).join(", ")} changed since the request was prepared.`);
  if (!request.total_minutes) throw billError(409, "TIME_BILLING_VERSION_CONFLICT", "Nothing is left in this request.");
  await client.query(`UPDATE tenant.project_time_billing_requests SET status = 'SUBMITTED', submitted_by = $3, submitted_at = now(), row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, request.id, c.userId ?? null]);
  await projectEvent(client, c, project.id, "TIME_BILLING_SUBMITTED", `BR-${request.request_number}: ${minutesLabel(request.total_minutes)} sent to Sales for invoicing`);
  await publishDomainEvent(client, { organizationId: c.organizationId, moduleKey: "projects", eventType: "projects.timesheet.billing_requested", entityType: "projects.timesheet", entityId: request.id,
    payload: { projectId: project.id, billingRequestId: request.id, billableMinutes: request.total_minutes, status: "SUBMITTED" } });
  await notifyTime(client, c, [request.created_by, project.manager_user_id], { category: "project_timesheet", title: `BR-${request.request_number} sent to Sales`,
    message: `${minutesLabel(request.total_minutes)} of ${project.project_code} time is ready for invoicing.`, href: `/projects/timesheets/billing/${request.id}`, entityType: "projects.time_billing_request", entityId: request.id });
  return { requestId: request.id, status: "SUBMITTED" };
}

// A request not invoiced is cancelled and its minutes released: a draft by its preparer or an authorizer; a request with Sales only by an
// authorizer (who confirms no invoice was raised for it). An invoiced request is adjusted through Sales instead.
export async function cancelTimeBillingRequest(client, c, requestId, input = {}) {
  const request = await lockRequest(client, c, requestId);
  if (request.status === "CANCELLED") return { requestId: request.id, status: "CANCELLED", replayed: true };
  if (request.status === "INVOICED" || request.status === "REVERSED") throw billError(409, "TIME_BILLING_INVOICE_EXISTS");
  const project = await loadProjectRow(client, c, request.project_id);
  if (request.status === "SUBMITTED" ? !mayAuthorize(c) : !(mayAuthorize(c) || (mayRequest(c, project) && request.created_by === c.userId))) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  versionCheck(request, input.expectedVersion);
  const reason = text(input.reason, 500);
  if (reason.length < 3) throw billError(400, "TIME_BILLING_REASON_REQUIRED", "Say why the request is cancelled.");
  await client.query(`UPDATE tenant.project_time_billing_allocations SET status = 'REVERSED', reversal_kind = 'RELEASED', reversed_by = $3, reversed_at = now(), reversal_reason = $4
      WHERE organization_id = $1 AND billing_request_id = $2 AND status = 'REQUESTED'`, [c.organizationId, request.id, c.userId ?? null, reason]);
  await client.query(`UPDATE tenant.project_time_billing_requests SET status = 'CANCELLED', cancelled_by = $3, cancelled_at = now(), cancel_reason = $4, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, request.id, c.userId ?? null, reason]);
  await projectEvent(client, c, project.id, "TIME_BILLING_CANCELLED", `BR-${request.request_number} cancelled: ${reason}; ${minutesLabel(request.total_minutes)} released`);
  return { requestId: request.id, status: "CANCELLED", releasedMinutes: request.total_minutes };
}

// Sales confirmed the invoice: link the request to its invoice line. The invoice must be a confirmed invoice of the project's customer whose
// line bills exactly the request's hours; one invoice line carries one request. input: { customerInvoiceLineId, expectedVersion? }
export async function confirmTimeBillingAllocation(client, c, requestId, input = {}) {
  const request = await lockRequest(client, c, requestId);
  const lineId = uuid(input.customerInvoiceLineId, "Invoice line");
  if (request.status === "INVOICED" && request.customer_invoice_line_id === lineId) return { requestId: request.id, status: "INVOICED", replayed: true };
  if (!mayAuthorize(c)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  if (request.status !== "SUBMITTED") throw billError(409, request.status === "INVOICED" ? "TIME_BILLING_INVOICE_EXISTS" : "TIME_BILLING_VERSION_CONFLICT",
    request.status === "DRAFT" ? "Send the request to Sales before linking its invoice." : undefined);
  versionCheck(request, input.expectedVersion);
  const project = await loadProjectRow(client, c, request.project_id);
  const line = (await client.query(`SELECT line.id, line.customer_invoice_id, line.quantity, line.net_amount, invoice.party_id, invoice.status, invoice.invoice_type, invoice.invoice_number, invoice.currency_code
      FROM tenant.accounting_customer_invoice_lines line JOIN tenant.accounting_customer_invoices invoice ON invoice.id = line.customer_invoice_id WHERE line.organization_id = $1 AND line.id = $2`,
  [c.organizationId, lineId])).rows[0];
  if (!line) throw billError(404, "TIME_BILLING_NOT_FOUND", "The invoice line could not be found.");
  if (line.party_id !== project.customer_id || line.party_id !== request.customer_id) throw billError(400, "TIME_BILLING_CUSTOMER_MISMATCH", "The invoice belongs to a different customer than the Project.");
  if (line.invoice_type !== "invoice") throw billError(400, "TIME_BILLING_NOT_ALLOWED", "Time is billed on an invoice, not a credit or debit note.");
  if (!CONFIRMED_INVOICE.includes(line.status)) throw billError(409, "TIME_BILLING_OUTCOME_UNKNOWN", `${line.invoice_number} is ${String(line.status).replace(/_/g, " ")}: link it once Sales has confirmed it. The minutes stay reserved meanwhile.`);
  if (line.currency_code && request.currency && line.currency_code.trim() !== request.currency.trim()) throw billError(400, "TIME_BILLING_NOT_ALLOWED", `The invoice is in ${line.currency_code}, the request in ${request.currency}.`);
  if (line.quantity !== null && Math.abs(Number(line.quantity) * 60 - request.total_minutes) >= 0.5) {
    throw billError(409, "TIME_BILLING_VERSION_CONFLICT", `The invoice line bills ${Number(line.quantity)} h; the request holds ${minutesLabel(request.total_minutes)} (${request.total_minutes / 60} h).`);
  }
  if ((await client.query(`SELECT 1 FROM tenant.project_time_billing_requests WHERE organization_id = $1 AND customer_invoice_line_id = $2 AND id <> $3 AND status IN ('INVOICED', 'SUBMITTED')`,
    [c.organizationId, line.id, request.id])).rows[0]) throw billError(409, "TIME_BILLING_ALREADY_ALLOCATED", "That invoice line already carries another time billing request.");
  await client.query(`UPDATE tenant.project_time_billing_allocations SET status = 'INVOICED', customer_invoice_id = $3, customer_invoice_line_id = $4, invoiced_by = $5, invoiced_at = now()
      WHERE organization_id = $1 AND billing_request_id = $2 AND status = 'REQUESTED'`, [c.organizationId, request.id, line.customer_invoice_id, line.id, c.userId ?? null]);
  await client.query(`UPDATE tenant.project_time_billing_requests SET status = 'INVOICED', customer_invoice_id = $3, customer_invoice_line_id = $4, invoiced_amount = $5, invoiced_by = $6, invoiced_at = now(),
      row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, request.id, line.customer_invoice_id, line.id, line.net_amount, c.userId ?? null]);
  await projectEvent(client, c, project.id, "TIME_INVOICED", `BR-${request.request_number}: ${minutesLabel(request.total_minutes)} invoiced on ${line.invoice_number}`);
  return { requestId: request.id, status: "INVOICED", invoiceNumber: line.invoice_number };
}

// The invoice behind an invoiced request was cancelled or reversed, or a credit note against it was issued. A credit never frees minutes by
// itself: an authorized disposition decides whether they may be billed again (Invoice From Billable Time). input: { creditNoteId?, minutes?,
// disposition: REBILLABLE | NOT_REBILLABLE, reason }
export async function reconcileTimeBillingAdjustments(client, c, requestId, input = {}) {
  const request = await lockRequest(client, c, requestId);
  if (!mayAuthorize(c)) throw billError(403, "TIME_BILLING_PERMISSION_DENIED");
  if (request.status !== "INVOICED") throw billError(409, "TIME_BILLING_VERSION_CONFLICT", request.status === "REVERSED" ? "This request is already fully reversed." : "Only invoiced time is reconciled.");
  const invoice = (await client.query(`SELECT id, invoice_number, status FROM tenant.accounting_customer_invoices WHERE id = $1`, [request.customer_invoice_id])).rows[0];
  if (!input.creditNoteId && !["cancelled", "reversed"].includes(invoice.status)) {
    throw billError(409, "TIME_BILLING_INVOICE_EXISTS", `${invoice.invoice_number} stands. Issue a credit note against it in Sales (or cancel it), then reconcile.`);
  }
  return recordTimeBillingDisposition(client, c, request.id, { documentId: input.creditNoteId ?? invoice.id, minutes: input.minutes, disposition: input.disposition, reason: input.reason });
}

// Whether a billing command sent with this key was applied (its answer was lost).
export async function recoverTimeBillingOperation(client, c, input = {}) {
  const key = keyOf(input);
  if (!key) throw billError(400, "TIME_BILLING_OUTCOME_UNKNOWN");
  const row = await replayOf(client, c, key);
  return row ? { applied: true, requestId: row.id, status: row.status } : { applied: false };
}

export async function requestNames(client, rows) {
  return userNames(client, rows.flatMap((row) => [row.created_by, row.submitted_by, row.invoiced_by, row.cancelled_by]));
}
