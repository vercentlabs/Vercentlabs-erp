// POS Day-End / Z Report (0107). The immutable reporting snapshot of one outlet's business day — built over the closed shifts and their cash
// sessions, cash differences, completed sales, applied payments, posted returns, refunds and issued GST documents. It never recalculates a
// cash balance, never edits or deletes a transaction, never resets anything and never posts to the ledger.
//
//   business day   date label + timezone + cut-off, frozen as a half-open UTC window [start, end) the first time the day is used. Each day starts
//                  where the previous one ended, so a cut-off change only affects days not yet created and no sale falls between two days.
//                  Closing a day before its scheduled end freezes the reporting cut-off at that moment; later sales belong to the next day.
//   attribution    sales by completion time, returns by posting time, refunds by their outcome time, GST documents by issue time, cash by the
//                  closing time of the shift it belongs to (a shift is reported once, on the day it closed).
//   X report       a read-only preview (any number of times, no number used, nothing written), with the exceptions as they stand.
//   Z report       begin closing → readiness (blocking / approvable / tracked exceptions) → approval of approvable exceptions by someone
//                  else, bound to the exact figures reviewed → finalize: one per day (row lock + unique index), idempotent on its key, the
//                  frozen snapshot and hash stored in the day-end report record that payment reconciliation and accounting posting read.
//   afterwards     late events (a refund that completed, a payment that resolved, a difference that was settled) are linked to the report as
//                  append-only adjustments; a reprint reproduces the frozen snapshot.
import { createHash } from "node:crypto";

import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { decimal, add, sub, asDatabaseDecimal, formatDecimal } from "../../../core/decimal.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess, accessiblePosStoreIds } from "../shared/access-control.js";
import { event as auditEvent } from "../shared/audit.js";
import { reconciliationSummaryForSales } from "./payment-reconciliation.js";
import { posPostingContext, postPosDayEndReportToAccounting } from "./accounting-posting.js";

export const POS_DAY_END_MESSAGES = Object.freeze({
  POS_DAY_END_PERMISSION_DENIED: "You do not have permission to close this business day.",
  POS_DAY_END_ALREADY_CLOSED: "This business day is already closed.",
  POS_DAY_END_NOT_CLOSING: "Start closing the business day first.",
  POS_DAY_END_DAY_INVALID: "Choose a business day that has started.",
  POS_DAY_END_SHIFT_OPEN: "One or more shifts must be closed or reviewed.",
  POS_DAY_END_CASH_UNRECONCILED: "A Cash drawer requires reconciliation.",
  POS_DAY_END_VARIANCE_APPROVAL_REQUIRED: "A Cash Difference needs approval.",
  POS_DAY_END_PAYMENT_UNRESOLVED: "Some payments need verification.",
  POS_DAY_END_SALE_RECOVERY_REQUIRED: "A Sale needs recovery before Day-End.",
  POS_DAY_END_INVENTORY_EXCEPTION: "Some completed Sales need Inventory reconciliation.",
  POS_DAY_END_INVOICE_EXCEPTION: "Invoice or credit-note records need review.",
  POS_DAY_END_FINANCE_EXCEPTION: "Finance reconciliation needs attention.",
  POS_DAY_END_REPORT_STALE: "Figures changed. Review the updated totals.",
  POS_DAY_END_APPROVAL_INVALID: "Approval no longer matches the report.",
  POS_DAY_END_APPROVAL_REQUIRED: "An exception needs approval by someone else before Day-End.",
  POS_DAY_END_SELF_APPROVAL: "You cannot approve exceptions you asked to approve.",
  POS_DAY_END_VERSION_CONFLICT: "The business-day record changed. Refresh and retry.",
  POS_DAY_END_ALREADY_FINALIZING: "Day-End is already being finalized.",
  POS_DAY_END_OUTCOME_UNKNOWN: "Checking whether Day-End completed. Do not finalize again.",
  POS_DAY_END_SNAPSHOT_ERROR: "Report preparation failed. Try recovery.",
  POS_DAY_END_DOCUMENT_UNAVAILABLE: "Report saved, but the document is temporarily unavailable.",
  POS_DAY_END_IDEMPOTENCY_CONFLICT: "This Day-End request was already used for another business day.",
  POS_Z_REPORT_NOT_FOUND: "Z report not found.",
});
const dayError = (status, code, message = POS_DAY_END_MESSAGES[code], details = undefined) => {
  const error = posError(status, message, code);
  if (details) error.details = details;
  return error;
};

// What each exception means for the close. BLOCKING: never overridden. APPROVABLE: closes only with an approval by someone other than the
// person who asked, for exactly the figures reviewed. TRACKED: carried forward with its owner; never blocks.
const EXCEPTIONS = Object.freeze({
  SHIFT_OPEN: { severity: "BLOCKING", error: "POS_DAY_END_SHIFT_OPEN" },
  CASH_CUSTODY_UNRESOLVED: { severity: "BLOCKING", error: "POS_DAY_END_CASH_UNRECONCILED" },
  CASH_REFUND_UNCONFIRMED: { severity: "BLOCKING", error: "POS_DAY_END_CASH_UNRECONCILED" },
  PAYMENT_UNRESOLVED: { severity: "BLOCKING", error: "POS_DAY_END_PAYMENT_UNRESOLVED" },
  SALE_RECOVERY_REQUIRED: { severity: "BLOCKING", error: "POS_DAY_END_SALE_RECOVERY_REQUIRED" },
  INVENTORY_EXCEPTION: { severity: "APPROVABLE", error: "POS_DAY_END_INVENTORY_EXCEPTION" },
  INVOICE_EXCEPTION: { severity: "APPROVABLE", error: "POS_DAY_END_INVOICE_EXCEPTION" },
  DOCUMENT_SEQUENCE_GAP: { severity: "APPROVABLE", error: "POS_DAY_END_INVOICE_EXCEPTION" },
  FINANCE_EXCEPTION: { severity: "APPROVABLE", error: "POS_DAY_END_FINANCE_EXCEPTION" },
  PROVIDER_REFUND_PENDING: { severity: "TRACKED" },
  CASH_DIFFERENCE_OPEN: { severity: "TRACKED" },
  CASH_TRANSFER_PENDING: { severity: "TRACKED" },
  CLOSING_EXCEPTION_OPEN: { severity: "TRACKED" },
  PAYMENT_UNDER_RECOVERY: { severity: "TRACKED" },
  // Payment Reconciliation (0108): duplicate or excess collections carry a correction obligation that reconciliation owns.
  RECONCILIATION_EXCEPTION_OPEN: { severity: "TRACKED" },
});

const SNAPSHOT_VERSION = 1;
const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const mayView = (c) => ["pos.report.view", "pos.report.generate", "pos.report.finalize", "pos.store.manage"].some((key) => can(c, key));
const mayPrepare = (c) => can(c, "pos.report.generate") || can(c, "pos.report.finalize");
const mayFinalize = (c) => can(c, "pos.report.finalize");
const mayApprove = (c) => can(c, "pos.reconciliation.approve");
const seesSensitive = (c) => can(c, "pos.report.finalize") || can(c, "pos.store.manage") || can(c, "pos.reconciliation.approve");
const text = (value, max = 500) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const money = (value) => {
  if (value === null || value === undefined) return "0.00";
  const [whole, fraction = ""] = formatDecimal(decimal(String(value))).split(".");
  return `${whole}.${(fraction + "00").slice(0, 2)}`;
};
const sum = (...values) => values.reduce((total, value) => add(total, decimal(String(value ?? "0"))), decimal("0"));
const out = (value) => money(asDatabaseDecimal(value));
// A DATE column as YYYY-MM-DD (pg hands it back as local midnight; toISOString would shift it a day east of UTC).
const dateText = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : String(value).slice(0, 10));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((name) => value[name] !== undefined).map((name) => `${JSON.stringify(name)}:${canonical(value[name])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
const hash = (value) => createHash("sha256").update(canonical(JSON.parse(JSON.stringify(value)))).digest("hex");
const event = (client, context, dayId, type, payload = {}) => auditEvent(client, context, "pos_business_day", dayId, type, payload);

// ------------------------------------------------------------------ the business day

async function storeOf(client, context, storeId) {
  if (!UUID.test(String(storeId ?? ""))) throw dayError(404, "POS_DAY_END_DAY_INVALID", "Outlet not found.");
  const store = (await client.query(
    `SELECT store.id, store.code, store.name, store.timezone, store.business_day_cutoff::text AS cutoff, COALESCE(NULLIF(btrim(store.currency_code), ''), 'INR') AS currency,
            organization.name AS company
       FROM tenant.pos_stores store LEFT JOIN public.organizations organization ON organization.id = store.organization_id
      WHERE store.organization_id = $1 AND store.id = $2`, [context.organizationId, storeId])).rows[0];
  if (!store) throw dayError(404, "POS_DAY_END_DAY_INVALID", "Outlet not found.");
  await assertPosStoreAccess(client, context, store.id);
  return { ...store, timezone: store.timezone || "Asia/Kolkata" };
}

// The outlet's business day for a date (today's by default): created once, with its window frozen. A day can only be created once it has
// started; it starts where the previous day ended (that day's frozen reporting cut-off, if it closed early) and ends where the next begins.
export async function resolveOutletBusinessDay(client, context, storeId, businessDate = null) {
  requirePermission(context, "pos.view");
  const store = await storeOf(client, context, storeId);
  const today = (await client.query(`SELECT ((now() AT TIME ZONE $1::text) - $2::time::interval)::date::text AS today`, [store.timezone, store.cutoff])).rows[0].today;
  const date = DATE.test(String(businessDate ?? "")) ? String(businessDate) : today;
  if (date > today) throw dayError(400, "POS_DAY_END_DAY_INVALID", "That business day has not started yet.");
  const existing = (await client.query(`SELECT * FROM tenant.pos_business_days WHERE organization_id = $1 AND store_id = $2 AND business_date = $3`, [context.organizationId, store.id, date])).rows[0];
  if (existing) return { day: existing, store };
  const window = (await client.query(
    `SELECT (($1::date + $2::time) AT TIME ZONE $3::text) AS start, ((($1::date + 1) + $2::time) AT TIME ZONE $3::text) AS finish,
            (SELECT COALESCE(previous.reporting_cutoff, previous.period_end) FROM tenant.pos_business_days previous
              WHERE previous.organization_id = $4 AND previous.store_id = $5 AND previous.business_date = $1::date - 1) AS previous_end,
            (SELECT next.period_start FROM tenant.pos_business_days next
              WHERE next.organization_id = $4 AND next.store_id = $5 AND next.business_date > $1::date ORDER BY next.business_date LIMIT 1) AS next_start`,
    [date, store.cutoff, store.timezone, context.organizationId, store.id])).rows[0];
  // Continuity: no gap and no overlap with the neighbouring days that already exist.
  // The day before is the only neighbour that can move the start (its frozen cut-off when it closed early, or its own end after a cut-off change).
  const start = window.previous_end ?? window.start;
  const end = window.next_start && new Date(window.next_start) < new Date(window.finish) ? window.next_start : window.finish;
  if (new Date(end) <= new Date(start)) throw dayError(409, "POS_DAY_END_DAY_INVALID", "This business day has no reporting period left (the previous day ended after it).");
  await client.query(
    `INSERT INTO tenant.pos_business_days (organization_id, store_id, business_date, timezone, cutoff_local_time, period_start, period_end)
     VALUES ($1, $2, $3, $4, $5::time, $6, $7) ON CONFLICT (organization_id, store_id, business_date) DO NOTHING`,
    [context.organizationId, store.id, date, store.timezone, store.cutoff, start, end]);
  const day = (await client.query(`SELECT * FROM tenant.pos_business_days WHERE organization_id = $1 AND store_id = $2 AND business_date = $3`, [context.organizationId, store.id, date])).rows[0];
  return { day, store };
}

async function loadDay(client, context, dayId, { lock = false } = {}) {
  requirePermission(context, "pos.view");
  if (!UUID.test(String(dayId ?? ""))) throw dayError(404, "POS_DAY_END_DAY_INVALID", "Business day not found.");
  const day = (await client.query(`SELECT * FROM tenant.pos_business_days WHERE organization_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}`, [context.organizationId, dayId])).rows[0];
  if (!day) throw dayError(404, "POS_DAY_END_DAY_INVALID", "Business day not found.");
  const store = await storeOf(client, context, day.store_id);
  return { day, store };
}

// The effective end of the reporting window: the frozen cut-off of a closed day, or now if the day is being closed before its scheduled end.
const effectiveEnd = (day, now) => (day.reporting_cutoff ? new Date(day.reporting_cutoff) : new Date(Math.min(new Date(day.period_end).getTime(), now.getTime())));

// The outlet's business-day cut-off (HH:MM local). Only days not yet created use it; closed and existing days keep their own window.
export async function setOutletBusinessDayCutoff(client, context, storeId, input = {}) {
  if (!can(context, "pos.store.manage")) throw dayError(403, "POS_DAY_END_PERMISSION_DENIED", "Only an outlet manager sets the business-day cut-off.");
  const value = String(input.cutoff ?? "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw dayError(400, "POS_DAY_END_DAY_INVALID", "Give the cut-off as HH:MM (24-hour), e.g. 04:00.");
  const store = await storeOf(client, context, storeId);
  await client.query(`UPDATE tenant.pos_stores SET business_day_cutoff = $3::time WHERE organization_id = $1 AND id = $2`, [context.organizationId, store.id, value]);
  await auditEvent(client, context, "pos_store", store.id, "pos.day_end.cutoff_changed", { from: store.cutoff, to: value });
  return { storeId: store.id, cutoff: value, appliesFrom: "business days not yet started or created" };
}

// ------------------------------------------------------------------ aggregation over the authoritative records

async function aggregate(client, context, day, store, end) {
  const org = context.organizationId;
  const start = day.period_start;
  const scope = [org, store.id, start, end];
  // Sales completed in the window (one row per sale, whatever its tenders).
  const sales = (await client.query(
    `SELECT sale.id, sale.subtotal, sale.discount_total, sale.taxable_total, sale.tax_total, sale.rounding_adjustment, sale.grand_total, sale.accounting_posting_status,
            sale.tax_document_type, sale.gst_invoice_id, sale.cart_id, sale.shift_id
       FROM tenant.pos_sales sale
      WHERE sale.organization_id = $1 AND sale.store_id = $2 AND sale.status IN ('completed', 'partially_returned', 'returned')
        AND COALESCE(sale.completed_at, sale.created_at) >= $3 AND COALESCE(sale.completed_at, sale.created_at) < $4
      ORDER BY sale.id`, scope)).rows;
  const saleIds = sales.map((row) => row.id);
  const lines = (await client.query(
    `SELECT COALESCE(sum(COALESCE(manual_discount_amount, 0) + COALESCE(promotion_discount_amount, 0) + COALESCE(coupon_discount_amount, 0)), 0)::text AS item_discounts,
            COALESCE(sum(COALESCE(cart_discount_amount, 0)), 0)::text AS cart_discounts, COALESCE(sum(COALESCE(loyalty_redeem_amount, 0)), 0)::text AS loyalty
       FROM tenant.pos_sale_lines WHERE organization_id = $1 AND sale_id = ANY($2::uuid[])`, [org, saleIds])).rows[0];
  const salesTotals = {
    count: sales.length,
    gross: out(sum(...sales.map((row) => row.subtotal))),
    itemDiscounts: money(lines.item_discounts), cartDiscounts: money(lines.cart_discounts), loyaltyRedemptions: money(lines.loyalty),
    totalDiscounts: out(sum(...sales.map((row) => row.discount_total))),
    taxableValue: out(sum(...sales.map((row) => row.taxable_total))), taxCharged: out(sum(...sales.map((row) => row.tax_total))),
    rounding: out(sum(...sales.map((row) => row.rounding_adjustment))), taxInclusiveConsideration: out(sum(...sales.map((row) => row.grand_total))),
  };
  salesTotals.netBeforeReturns = out(sub(decimal(salesTotals.gross), decimal(salesTotals.totalDiscounts)));
  const carts = (await client.query(
    `SELECT count(*) FILTER (WHERE status = 'cancelled' AND cancelled_at >= $3 AND cancelled_at < $4)::int AS cancelled,
            count(*) FILTER (WHERE status = 'expired' AND updated_at >= $3 AND updated_at < $4)::int AS expired
       FROM tenant.pos_carts WHERE organization_id = $1 AND store_id = $2`, scope)).rows[0];

  // Returns posted in the window (their sales may be older); their refunds are reported separately.
  const returns = (await client.query(
    `SELECT id, return_value, tax_adjustment_amount, refund_total, credit_note_number, accounting_posting_status FROM tenant.pos_returns
      WHERE organization_id = $1 AND store_id = $2 AND lifecycle_status = 'posted' AND posted_at >= $3 AND posted_at < $4 ORDER BY id`, scope)).rows;
  const returnsTotals = { count: returns.length, value: out(sum(...returns.map((row) => row.return_value))), taxAdjustment: out(sum(...returns.map((row) => row.tax_adjustment_amount))),
    refundDue: out(sum(...returns.map((row) => row.refund_total))) };
  salesTotals.returns = returnsTotals.value;
  salesTotals.netAfterReturns = out(sub(decimal(salesTotals.netBeforeReturns), decimal(returnsTotals.value)));
  salesTotals.averageSale = sales.length ? out(decimal(String(Number(salesTotals.taxInclusiveConsideration) / sales.length))) : "0.00";
  salesTotals.cancelledUnpaidBills = carts.cancelled;
  salesTotals.expiredBills = carts.expired;

  // Collections: the applied tender components of those sales (a split sale counts once as a sale, once per tender here).
  const tenders = (await client.query(
    `SELECT payment.payment_method AS method, COALESCE(payment.verification_status, 'provider_verified') AS verification, count(*)::int AS count,
            COALESCE(sum(payment.amount), 0)::text AS amount, COALESCE(sum(payment.cash_received_amount), 0)::text AS received, COALESCE(sum(payment.change_given_amount), 0)::text AS change
       FROM tenant.pos_payments payment
      WHERE payment.organization_id = $1 AND payment.sale_id = ANY($2::uuid[]) AND payment.status IN ('captured', 'partially_refunded', 'refunded')
      GROUP BY 1, 2 ORDER BY 1, 2`, [org, saleIds])).rows;
  const methods = {};
  for (const row of tenders) {
    const entry = methods[row.method] ?? (methods[row.method] = { method: row.method, count: 0, amount: decimal("0"), providerVerified: decimal("0"), externallyAttested: decimal("0"),
      cashReceived: decimal("0"), changeGiven: decimal("0") });
    entry.count += row.count;
    entry.amount = add(entry.amount, decimal(row.amount));
    if (row.verification === "externally_attested") entry.externallyAttested = add(entry.externallyAttested, decimal(row.amount));
    else entry.providerVerified = add(entry.providerVerified, decimal(row.amount));
    entry.cashReceived = add(entry.cashReceived, decimal(row.received));
    entry.changeGiven = add(entry.changeGiven, decimal(row.change));
  }
  const collections = Object.values(methods).map((entry) => ({ method: entry.method, count: entry.count, amount: out(entry.amount),
    ...(entry.method === "cash" ? { cashReceived: out(entry.cashReceived), changeGiven: out(entry.changeGiven) } : { providerVerified: out(entry.providerVerified), externallyAttested: out(entry.externallyAttested) }) }));
  const split = (await client.query(
    `SELECT count(*)::int AS sales FROM (SELECT sale_id FROM tenant.pos_payments WHERE organization_id = $1 AND sale_id = ANY($2::uuid[]) AND status IN ('captured', 'partially_refunded', 'refunded')
      GROUP BY sale_id HAVING count(*) > 1) split`, [org, saleIds])).rows[0].sales;
  const attempts = (await client.query(
    `SELECT payment_method AS method, status, count(*)::int AS count, COALESCE(sum(amount), 0)::text AS amount FROM tenant.pos_payments
      WHERE organization_id = $1 AND store_id = $2 AND status IN ('failed', 'voided') AND initiated_at >= $3 AND initiated_at < $4 GROUP BY 1, 2 ORDER BY 1, 2`, scope)).rows;
  const unapplied = (await client.query(
    `SELECT payment_method AS method, count(*)::int AS count, COALESCE(sum(amount), 0)::text AS amount FROM tenant.pos_payments
      WHERE organization_id = $1 AND store_id = $2 AND sale_id IS NULL AND status = 'captured' AND payment_method <> 'cash' AND initiated_at >= $3 AND initiated_at < $4
        AND COALESCE(recovery_status, '') NOT IN ('refunded', 'resolved') GROUP BY 1 ORDER BY 1`, scope)).rows;
  const settlement = (await client.query(
    `SELECT settlement_status AS status, count(*)::int AS count, COALESCE(sum(amount), 0)::text AS amount FROM tenant.pos_payments
      WHERE organization_id = $1 AND sale_id = ANY($2::uuid[]) AND payment_method <> 'cash' AND status IN ('captured', 'partially_refunded', 'refunded') GROUP BY 1 ORDER BY 1`, [org, saleIds])).rows;

  // Refunds: paid in the window (by outcome time), failed in the window, and outstanding at the cut-off.
  const refunds = (await client.query(
    `SELECT component.refund_method AS method,
            CASE WHEN component.status = 'succeeded' AND component.resolved_at >= $3 AND component.resolved_at < $4 THEN 'paid'
                 WHEN component.status = 'failed' AND COALESCE(component.resolved_at, component.updated_at) >= $3 AND COALESCE(component.resolved_at, component.updated_at) < $4 THEN 'failed'
                 WHEN component.status IN ('pending', 'submitted', 'processing', 'unknown', 'cancel_pending') AND component.created_at < $4 THEN 'outstanding' END AS bucket,
            count(*)::int AS count, COALESCE(sum(CASE WHEN component.status = 'succeeded' THEN component.successful_amount ELSE component.allocated_amount END), 0)::text AS amount
       FROM tenant.payment_refund_components component
       JOIN tenant.payment_refunds refund ON refund.organization_id = component.organization_id AND refund.id = component.refund_id
      WHERE component.organization_id = $1 AND refund.store_id = $2 GROUP BY 1, 2 HAVING bool_or(true) ORDER BY 1, 2`, scope)).rows.filter((row) => row.bucket);
  const refundBucket = (bucket) => out(sum(...refunds.filter((row) => row.bucket === bucket).map((row) => row.amount)));

  // GST documents issued in the window (the authoritative tax documents; the Z report only summarises them).
  const documents = (await client.query(
    `SELECT document_type, count(*) FILTER (WHERE document_status = 'issued')::int AS issued, count(*) FILTER (WHERE document_status = 'cancelled')::int AS cancelled,
            COALESCE(sum(taxable_total) FILTER (WHERE document_status = 'issued'), 0)::text AS taxable, COALESCE(sum(cgst_total) FILTER (WHERE document_status = 'issued'), 0)::text AS cgst,
            COALESCE(sum(sgst_total) FILTER (WHERE document_status = 'issued'), 0)::text AS sgst, COALESCE(sum(igst_total) FILTER (WHERE document_status = 'issued'), 0)::text AS igst,
            COALESCE(sum(utgst_total) FILTER (WHERE document_status = 'issued'), 0)::text AS utgst, COALESCE(sum(cess_total) FILTER (WHERE document_status = 'issued'), 0)::text AS cess,
            COALESCE(sum(grand_total) FILTER (WHERE document_status = 'issued'), 0)::text AS total, min(invoice_number) AS first_number, max(invoice_number) AS last_number
       FROM tenant.gst_invoices WHERE organization_id = $1 AND store_id = $2 AND issued_at >= $3 AND issued_at < $4 GROUP BY 1 ORDER BY 1`, scope)).rows;
  const rates = (await client.query(
    `SELECT invoice.document_type, line.tax_classification AS classification, line.tax_rate::text AS rate, count(*)::int AS lines,
            COALESCE(sum(line.taxable_amount), 0)::text AS taxable, COALESCE(sum(line.cgst_amount), 0)::text AS cgst, COALESCE(sum(line.sgst_amount), 0)::text AS sgst,
            COALESCE(sum(line.igst_amount), 0)::text AS igst, COALESCE(sum(line.utgst_amount), 0)::text AS utgst, COALESCE(sum(line.cess_amount), 0)::text AS cess
       FROM tenant.gst_invoice_lines line JOIN tenant.gst_invoices invoice ON invoice.organization_id = line.organization_id AND invoice.id = line.invoice_id
      WHERE invoice.organization_id = $1 AND invoice.store_id = $2 AND invoice.issued_at >= $3 AND invoice.issued_at < $4 AND invoice.document_status = 'issued'
      GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, scope)).rows;
  const einvoice = (await client.query(
    `SELECT einvoice_status AS status, count(*)::int AS count FROM tenant.gst_invoices WHERE organization_id = $1 AND store_id = $2 AND issued_at >= $3 AND issued_at < $4
      GROUP BY 1 ORDER BY 1`, scope)).rows;

  // Cash: each shift closed in the window, from its own frozen closing record (the cash session ledger already reconciled it).
  const closings = (await client.query(
    `SELECT closing.id, closing.shift_id, closing.cash_session_id, closing.closing_status, closing.closed_at, closing.opening_float_amount, closing.expected_cash_amount,
            closing.counted_cash_amount, closing.variance_amount, closing.variance_reason_code, closing.approval_id, closing.cash_custody_status, closing.snapshot -> 'cash' -> 'breakdown' AS breakdown,
            shift.shift_number, shift.opened_at, terminal.code AS terminal_code, cashier.full_name AS cashier_name, drawer.code AS drawer_code
       FROM tenant.pos_shift_closings closing
       JOIN tenant.pos_shifts shift ON shift.organization_id = closing.organization_id AND shift.id = closing.shift_id
       JOIN tenant.pos_terminals terminal ON terminal.organization_id = closing.organization_id AND terminal.id = closing.terminal_id
       LEFT JOIN public.users cashier ON cashier.id = closing.cashier_user_id
       LEFT JOIN tenant.pos_cash_sessions cash ON cash.organization_id = closing.organization_id AND cash.id = closing.cash_session_id
       LEFT JOIN tenant.pos_cash_drawers drawer ON drawer.organization_id = cash.organization_id AND drawer.id = cash.cash_drawer_id
      WHERE closing.organization_id = $1 AND closing.store_id = $2 AND closing.closed_at >= $3 AND closing.closed_at < $4 ORDER BY closing.closed_at, closing.id`, scope)).rows;
  const cashClosings = closings.filter((row) => row.cash_session_id);
  const field = (name) => out(sum(...cashClosings.map((row) => row.breakdown?.[name] ?? "0")));
  const shortages = cashClosings.filter((row) => Number(row.variance_amount) < 0);
  const overages = cashClosings.filter((row) => Number(row.variance_amount) > 0);
  const transfers = (await client.query(
    `SELECT transfer.destination_type AS type, count(*)::int AS count, COALESCE(sum(transfer.amount), 0)::text AS amount,
            count(*) FILTER (WHERE transfer.status = 'ACCEPTED' AND transfer.accepted_at < $4)::int AS accepted,
            COALESCE(sum(transfer.amount) FILTER (WHERE transfer.status = 'PENDING_ACCEPTANCE' OR transfer.accepted_at >= $4), 0)::text AS pending_amount
       FROM tenant.pos_cash_custody_transfers transfer JOIN tenant.pos_shift_closings closing ON closing.organization_id = transfer.organization_id AND closing.id = transfer.closing_id
      WHERE transfer.organization_id = $1 AND transfer.store_id = $2 AND closing.closed_at >= $3 AND closing.closed_at < $4 GROUP BY 1 ORDER BY 1`, scope)).rows;
  const cash = {
    attribution: "Shifts closed in the period, from each closing's frozen cash session reconciliation.",
    sessions: cashClosings.length,
    appliedToSales: collections.find((row) => row.method === "cash")?.amount ?? "0.00",
    openingFloats: out(sum(...cashClosings.map((row) => row.opening_float_amount))), openingFloatsNote: "Custody already owned by the business — not revenue.",
    cashReceived: field("cashReceived"), changeGiven: field("changeGiven"), uncompletedTendersReturned: field("uncompletedTendersReturned"), cashRefundsPaid: field("cashRefundsPaid"),
    cashMovementIn: field("cashMovementIn"), cashMovementOut: field("cashMovementOut"),
    expected: out(sum(...cashClosings.map((row) => row.expected_cash_amount))), counted: out(sum(...cashClosings.map((row) => row.counted_cash_amount))),
    shortageTotal: out(sub(decimal("0"), sum(...shortages.map((row) => row.variance_amount)))), shortageCount: shortages.length,
    overageTotal: out(sum(...overages.map((row) => row.variance_amount))), overageCount: overages.length,
    netVariance: out(sum(...cashClosings.map((row) => row.variance_amount))),
    destinations: transfers.map((row) => ({ type: row.type, count: row.count, amount: money(row.amount), accepted: row.accepted, pendingAmount: money(row.pending_amount) })),
    custodyPendingAcceptance: out(sum(...transfers.map((row) => row.pending_amount))),
    perSession: cashClosings.map((row) => ({ shiftNumber: row.shift_number, terminal: row.terminal_code, drawer: row.drawer_code, cashier: row.cashier_name, closedAt: row.closed_at,
      openingFloat: money(row.opening_float_amount), expected: money(row.expected_cash_amount), counted: money(row.counted_cash_amount), variance: money(row.variance_amount),
      reasonCode: row.variance_reason_code, approved: Boolean(row.approval_id), custody: row.cash_custody_status })),
  };
  const differences = (await client.query(
    `SELECT difference_context AS context, count(*) FILTER (WHERE difference_amount < 0)::int AS shortages, COALESCE(sum(-difference_amount) FILTER (WHERE difference_amount < 0), 0)::text AS shortage_amount,
            count(*) FILTER (WHERE difference_amount > 0)::int AS overages, COALESCE(sum(difference_amount) FILTER (WHERE difference_amount > 0), 0)::text AS overage_amount,
            count(*) FILTER (WHERE approval_id IS NOT NULL)::int AS approved, count(*) FILTER (WHERE case_status <> 'RESOLVED')::int AS unresolved
       FROM tenant.pos_cash_differences WHERE organization_id = $1 AND store_id = $2 AND created_at >= $3 AND created_at < $4 GROUP BY 1 ORDER BY 1`, scope)).rows
    .map((row) => ({ context: row.context, shortages: row.shortages, shortageAmount: money(row.shortage_amount), overages: row.overages, overageAmount: money(row.overage_amount),
      approved: row.approved, unresolved: row.unresolved }));

  // Shifts that touch the window, and the ones the day reports (closed in it).
  const shifts = (await client.query(
    `SELECT shift.id, shift.shift_number, shift.lifecycle_status, shift.opened_at, shift.closed_at, shift.cash_session_id, terminal.code AS terminal_code, cashier.full_name AS cashier_name
       FROM tenant.pos_shifts shift JOIN tenant.pos_terminals terminal ON terminal.organization_id = shift.organization_id AND terminal.id = shift.terminal_id
       LEFT JOIN public.users cashier ON cashier.id = shift.cashier_user_id
      WHERE shift.organization_id = $1 AND shift.store_id = $2 AND COALESCE(shift.opened_at, shift.created_at) < $4 AND (shift.closed_at IS NULL OR shift.closed_at >= $3)
      ORDER BY shift.opened_at NULLS LAST, shift.id`, scope)).rows;
  const shiftSummary = shifts.map((row) => ({ id: row.id, shiftNumber: row.shift_number, terminal: row.terminal_code, cashier: row.cashier_name, status: row.lifecycle_status,
    openedAt: row.opened_at, closedAt: row.closed_at, cashEnabled: Boolean(row.cash_session_id),
    reportedHere: Boolean(row.closed_at) && new Date(row.closed_at) >= new Date(start) && new Date(row.closed_at) < new Date(end) }));
  const reportedShiftIds = closings.map((row) => row.shift_id);
  const movementIds = reportedShiftIds.length ? (await client.query(`SELECT id FROM tenant.pos_cash_movements WHERE organization_id = $1 AND shift_id = ANY($2::uuid[]) ORDER BY id`,
    [org, reportedShiftIds])).rows.map((row) => row.id) : [];

  const finance = {
    sales: Object.fromEntries((await client.query(`SELECT accounting_posting_status AS status, count(*)::int AS n FROM tenant.pos_sales WHERE organization_id = $1 AND id = ANY($2::uuid[]) GROUP BY 1`,
      [org, saleIds])).rows.map((row) => [row.status, row.n])),
    returns: Object.fromEntries(returns.reduce((map, row) => map.set(row.accounting_posting_status, (map.get(row.accounting_posting_status) ?? 0) + 1), new Map())),
    settlement: settlement.map((row) => ({ status: row.status, count: row.count, amount: money(row.amount) })),
    note: "Card and UPI collections are confirmed at the counter; provider settlement to the bank is reconciled separately and does not block Day-End.",
    // Payment Reconciliation (0108): how far the day's card / UPI collections have got — matched by the provider, settled, still awaited.
    reconciliation: await reconciliationSummaryForSales(client, org, saleIds),
  };

  // Source watermarks: what the figures were built from — any change to a source in scope changes the preview hash.
  const watermarks = (await client.query(
    `SELECT (SELECT count(*) FROM tenant.pos_sales WHERE organization_id = $1 AND store_id = $2 AND COALESCE(completed_at, created_at) >= $3 AND COALESCE(completed_at, created_at) < $4)::int AS sales,
            (SELECT max(updated_at)::text FROM tenant.pos_payments WHERE organization_id = $1 AND store_id = $2 AND initiated_at < $4) AS payments_updated,
            (SELECT count(*) FROM tenant.pos_payments WHERE organization_id = $1 AND store_id = $2 AND initiated_at < $4)::int AS payments,
            (SELECT max(component.updated_at)::text FROM tenant.payment_refund_components component JOIN tenant.payment_refunds refund ON refund.id = component.refund_id
              WHERE component.organization_id = $1 AND refund.store_id = $2) AS refunds_updated,
            (SELECT count(*) FROM tenant.pos_returns WHERE organization_id = $1 AND store_id = $2 AND posted_at >= $3 AND posted_at < $4)::int AS returns,
            (SELECT count(*) FROM tenant.pos_shift_closings WHERE organization_id = $1 AND store_id = $2 AND closed_at < $4)::int AS closings,
            (SELECT count(*) FROM tenant.gst_invoices WHERE organization_id = $1 AND store_id = $2 AND issued_at < $4)::int AS documents,
            (SELECT max(updated_at)::text FROM tenant.pos_carts WHERE organization_id = $1 AND store_id = $2) AS carts_updated,
            (SELECT count(*) FROM tenant.pos_cash_differences WHERE organization_id = $1 AND store_id = $2)::int AS differences,
            (SELECT count(*) FROM tenant.pos_cash_custody_transfers WHERE organization_id = $1 AND store_id = $2 AND status = 'ACCEPTED')::int AS transfers_accepted`, scope)).rows[0];

  return {
    sales, salesTotals, returns, returnsTotals, collections, split, attempts, unapplied, refunds, refundBucket, documents, rates, einvoice, cash, differences, shiftSummary,
    reportedShiftIds, movementIds, finance, watermarks,
  };
}

// The exceptions as they stand at the cut-off: [{ code, severity, sourceType, sourceId, label, exposure, owner }].
async function findDayEndExceptions(client, context, day, store, end, data) {
  const org = context.organizationId;
  const scope = [org, store.id, day.period_start, end];
  // Every query here takes the same parameters; some use only the end of the window, so their types are declared once up front.
  const q = (sql, values) => client.query(`WITH day_window AS (SELECT $3::timestamptz AS starts, $4::timestamptz AS ends) ${sql}`, values);
  const found = [];
  const push = (code, sourceType, sourceId, label, exposure = null, owner = null) => found.push({ code, severity: EXCEPTIONS[code].severity, sourceType, sourceId, label,
    exposure: exposure === null ? null : money(exposure), owner });
  for (const row of data.shiftSummary.filter((shift) => !["CLOSED", "FORCE_CLOSED"].includes(shift.status)))
    push("SHIFT_OPEN", "pos_shift", row.id, `Shift ${row.shiftNumber} at ${row.terminal} is ${String(row.status).toLowerCase().replace(/_/g, " ")}`);
  for (const row of (await q(
    `SELECT id, amount FROM tenant.pos_payments WHERE organization_id = $1 AND store_id = $2 AND payment_method = 'cash' AND custody_status IN ('pending', 'reconciliation_required') AND initiated_at < $4`,
    scope)).rows) push("CASH_CUSTODY_UNRESOLVED", "pos_payment", row.id, "Cash taken for a bill that is not finalized", row.amount);
  for (const row of (await q(
    `SELECT component.id, component.allocated_amount, refund.refund_number FROM tenant.payment_refund_components component
       JOIN tenant.payment_refunds refund ON refund.organization_id = component.organization_id AND refund.id = component.refund_id
      WHERE component.organization_id = $1 AND refund.store_id = $2 AND component.refund_method = 'cash' AND component.status IN ('pending', 'submitted', 'processing', 'unknown', 'cancel_pending')
        AND component.created_at < $4`, scope)).rows) push("CASH_REFUND_UNCONFIRMED", "payment_refund_component", row.id, `Cash refund ${row.refund_number}: payout not confirmed`, row.allocated_amount);
  // A payment whose outcome is unknown, or money collected for a sale that never completed: blocking unless a shift closing gave it an owner.
  const owned = new Map((await client.query(
    `SELECT exception.reference_id, users.full_name FROM tenant.pos_shift_closing_exceptions exception LEFT JOIN public.users ON users.id = exception.assigned_to
      JOIN tenant.pos_shifts shift ON shift.organization_id = exception.organization_id AND shift.id = exception.shift_id
     WHERE exception.organization_id = $1 AND shift.store_id = $2 AND exception.status <> 'RESOLVED' AND exception.reference_type = 'pos_payment'`, [org, store.id])).rows
    .map((row) => [row.reference_id, row.full_name ?? "assigned owner"]));
  for (const row of (await q(
    `SELECT id, amount, payment_method, sale_id, status, attempt_status FROM tenant.pos_payments
      WHERE organization_id = $1 AND store_id = $2 AND payment_method <> 'cash' AND initiated_at < $4 AND COALESCE(recovery_status, '') NOT IN ('refunded', 'resolved')
        AND (status IN ('initiated', 'pending', 'authorized') OR attempt_status IN ('unknown', 'reconciliation_required', 'cancel_pending') OR (status = 'captured' AND sale_id IS NULL))
        AND NOT EXISTS (SELECT 1 FROM tenant.pos_carts cart WHERE cart.organization_id = pos_payments.organization_id AND cart.id = pos_payments.cart_id AND cart.status IN ('draft', 'priced')
                          AND cart.checkout_started_at IS NOT NULL)`, scope)).rows) {
    const collected = row.status === "captured" && !row.sale_id;
    const label = collected ? `${String(row.payment_method).toUpperCase()} collected for a sale that did not complete` : `${String(row.payment_method).toUpperCase()} payment outcome unknown`;
    if (owned.has(row.id)) push("PAYMENT_UNDER_RECOVERY", "pos_payment", row.id, `${label} — owner: ${owned.get(row.id)}`, row.amount, owned.get(row.id));
    else push(collected ? "SALE_RECOVERY_REQUIRED" : "PAYMENT_UNRESOLVED", "pos_payment", row.id, label, row.amount);
  }
  for (const row of (await q(
    `SELECT cart.id, sale.grand_total FROM tenant.pos_carts cart JOIN tenant.pos_sales sale ON sale.organization_id = cart.organization_id AND sale.cart_id = cart.id
      WHERE cart.organization_id = $1 AND cart.store_id = $2 AND cart.stock_recovery_status = 'required' AND sale.id = ANY($5::uuid[])`, [...scope, data.sales.map((sale) => sale.id)])).rows)
    push("INVENTORY_EXCEPTION", "pos_cart", row.id, "A completed sale's stock still needs reconciliation", row.grand_total);
  for (const sale of data.sales.filter((row) => ["tax_invoice", "bill_of_supply", "invoice_cum_bill_of_supply"].includes(row.tax_document_type) && !row.gst_invoice_id))
    push("INVOICE_EXCEPTION", "pos_sale", sale.id, "A sale that needs a GST document has none", sale.grand_total);
  for (const row of (await q(
    `SELECT id, invoice_number, einvoice_status, grand_total FROM tenant.gst_invoices WHERE organization_id = $1 AND store_id = $2 AND issued_at >= $3 AND issued_at < $4
        AND einvoice_status IN ('failed', 'unknown', 'reconciliation_required')`, scope)).rows)
    push("INVOICE_EXCEPTION", "gst_invoice", row.id, `${row.invoice_number}: e-invoice ${row.einvoice_status.replace(/_/g, " ")}`, row.grand_total);
  // Document numbering: within one series, the numbers issued in the window must run without gaps.
  const numbers = (await q(
    `SELECT series_id, id, invoice_number FROM tenant.gst_invoices WHERE organization_id = $1 AND store_id = $2 AND issued_at >= $3 AND issued_at < $4 AND series_id IS NOT NULL
      ORDER BY series_id, invoice_number`, scope)).rows;
  const bySeries = new Map();
  for (const row of numbers) { const match = /(\d+)$/.exec(row.invoice_number); if (match) (bySeries.get(row.series_id) ?? bySeries.set(row.series_id, []).get(row.series_id)).push({ ...row, n: Number(match[1]) }); }
  for (const list of bySeries.values()) {
    list.sort((a, b) => a.n - b.n);
    for (let index = 1; index < list.length; index += 1) if (list[index].n > list[index - 1].n + 1)
      push("DOCUMENT_SEQUENCE_GAP", "gst_invoice", list[index].id, `Document numbers missing between ${list[index - 1].invoice_number} and ${list[index].invoice_number}`);
  }
  for (const sale of data.sales.filter((row) => row.accounting_posting_status === "failed")) push("FINANCE_EXCEPTION", "pos_sale", sale.id, "Accounting posting failed for a sale", sale.grand_total);
  for (const ret of data.returns.filter((row) => row.accounting_posting_status === "failed")) push("FINANCE_EXCEPTION", "pos_return", ret.id, "Accounting posting failed for a return", ret.return_value);
  // Tracked, never blocking: refunds still with the provider, open cash differences, cash awaiting acceptance, closing exceptions with an owner.
  for (const row of (await q(
    `SELECT component.id, component.refund_method, component.status, component.allocated_amount, refund.refund_number FROM tenant.payment_refund_components component
       JOIN tenant.payment_refunds refund ON refund.organization_id = component.organization_id AND refund.id = component.refund_id
      WHERE component.organization_id = $1 AND refund.store_id = $2 AND component.refund_method <> 'cash' AND component.status IN ('pending', 'submitted', 'processing', 'unknown', 'cancel_pending')
        AND component.created_at < $4`, scope)).rows)
    push("PROVIDER_REFUND_PENDING", "payment_refund_component", row.id, `${String(row.refund_method).toUpperCase()} refund ${row.refund_number} ${row.status} — refund reconciliation`, row.allocated_amount, "Refund reconciliation");
  for (const row of (await q(
    `SELECT difference.id, difference.difference_number, difference.difference_amount, difference.case_status, users.full_name FROM tenant.pos_cash_differences difference
       LEFT JOIN public.users ON users.id = difference.assigned_to
      WHERE difference.organization_id = $1 AND difference.store_id = $2 AND difference.case_status <> 'RESOLVED' AND difference.created_at < $4`, scope)).rows)
    push("CASH_DIFFERENCE_OPEN", "pos_cash_difference", row.id, `Cash difference ${row.difference_number} ${row.case_status.toLowerCase()}`, row.difference_amount, row.full_name ?? "Cash control");
  for (const row of (await q(
    `SELECT exception.id, exception.exception_number, exception.exception_code, exception.exposure_amount, users.full_name FROM tenant.payment_reconciliation_exceptions exception
       LEFT JOIN public.users ON users.id = exception.assigned_to
      WHERE exception.organization_id = $1 AND exception.store_id = $2 AND exception.status <> 'RESOLVED' AND exception.exception_code IN ('PAYMENT_DUPLICATE', 'PAYMENT_UNAPPLIED')
        AND exception.detected_at < $4`, scope)).rows)
    push("RECONCILIATION_EXCEPTION_OPEN", "payment_reconciliation_exception", row.id, `${row.exception_number}: ${row.exception_code.toLowerCase().replace(/_/g, " ")} — correction owed`, row.exposure_amount,
      row.full_name ?? "Payment reconciliation");
  for (const row of (await q(
    `SELECT transfer.id, transfer.destination_type, transfer.amount FROM tenant.pos_cash_custody_transfers transfer
      WHERE transfer.organization_id = $1 AND transfer.store_id = $2 AND transfer.status = 'PENDING_ACCEPTANCE' AND transfer.created_at < $4`, scope)).rows)
    push("CASH_TRANSFER_PENDING", "pos_cash_custody_transfer", row.id, `Closing cash (${row.destination_type.toLowerCase().replace(/_/g, " ")}) waiting to be accepted`, row.amount, "Receiving custodian");
  for (const row of (await q(
    `SELECT exception.id, exception.exception_type, exception.amount, users.full_name, exception.assigned_queue FROM tenant.pos_shift_closing_exceptions exception
       JOIN tenant.pos_shifts shift ON shift.organization_id = exception.organization_id AND shift.id = exception.shift_id
       LEFT JOIN public.users ON users.id = exception.assigned_to
      WHERE exception.organization_id = $1 AND shift.store_id = $2 AND exception.status <> 'RESOLVED' AND exception.reference_type <> 'pos_payment' AND exception.created_at < $4`, scope)).rows)
    push("CLOSING_EXCEPTION_OPEN", "pos_shift_closing_exception", row.id, `Closing item: ${row.exception_type.toLowerCase().replace(/_/g, " ")}`, row.amount, row.full_name ?? row.assigned_queue);
  return found;
}

// The frozen content: sections A-L and the preview hash (figures + exception identities — not who looked or when).
async function buildSnapshot(client, context, day, store, now = new Date()) {
  const end = effectiveEnd(day, now);
  const data = await aggregate(client, context, day, store, end);
  const exceptions = await findDayEndExceptions(client, context, day, store, end, data);
  const body = {
    version: SNAPSHOT_VERSION,
    identity: { company: store.company, outlet: store.name, outletCode: store.code, businessDate: dateText(day.business_date),
      timezone: day.timezone, cutoff: String(day.cutoff_local_time).slice(0, 5), periodStart: new Date(day.period_start).toISOString(), periodEnd: end.toISOString(),
      scheduledEnd: new Date(day.period_end).toISOString(), currency: store.currency },
    attribution: { sales: "completion time", returns: "posting time", refunds: "outcome time (outstanding as at the cut-off)", taxDocuments: "issue time",
      cash: "closing time of each shift (reported once, on the day it closed)" },
    sales: data.salesTotals,
    tax: {
      documents: data.documents.map((row) => ({ type: row.document_type, issued: row.issued, cancelled: row.cancelled, taxable: money(row.taxable), cgst: money(row.cgst), sgst: money(row.sgst),
        igst: money(row.igst), utgst: money(row.utgst), cess: money(row.cess), total: money(row.total), firstNumber: row.first_number, lastNumber: row.last_number })),
      byRate: data.rates.map((row) => ({ documentType: row.document_type, classification: row.classification, rate: money(row.rate), lines: row.lines, taxable: money(row.taxable),
        cgst: money(row.cgst), sgst: money(row.sgst), igst: money(row.igst), utgst: money(row.utgst), cess: money(row.cess) })),
      einvoice: data.einvoice, note: "Summarises issued GST documents; the Z report is not itself a tax invoice, credit note or GST return.",
    },
    collections: { byMethod: data.collections, total: out(sum(...data.collections.map((row) => row.amount))), splitSales: data.split,
      failedOrVoided: data.attempts.map((row) => ({ method: row.method, status: row.status, count: row.count, amount: money(row.amount) })),
      unapplied: data.unapplied.map((row) => ({ method: row.method, count: row.count, amount: money(row.amount) })) },
    returns: data.returnsTotals,
    refunds: { paid: data.refundBucket("paid"), failed: data.refundBucket("failed"), outstanding: data.refundBucket("outstanding"),
      byMethod: data.refunds.map((row) => ({ method: row.method, bucket: row.bucket, count: row.count, amount: money(row.amount) })) },
    cash: data.cash,
    cashDifferences: data.differences,
    shifts: { total: data.shiftSummary.length, closed: data.shiftSummary.filter((row) => ["CLOSED", "FORCE_CLOSED"].includes(row.status)).length, list: data.shiftSummary },
    exceptions: exceptions.map((row) => ({ code: row.code, severity: row.severity, sourceType: row.sourceType, sourceId: row.sourceId, label: row.label, exposure: row.exposure, owner: row.owner })),
    finance: data.finance,
    sources: data.watermarks,
  };
  // The preview hash covers the figures and exceptions, not the clock: for a day closed before its scheduled end the window end is "now" until it
  // is frozen, and any sale or payment after a preview changes the figures (and so the hash) anyway.
  return { body, previewHash: hash({ ...body, identity: { ...body.identity, periodEnd: undefined } }), data, exceptions, end };
}

// ------------------------------------------------------------------ reading: context, X report, readiness

function dayView(day) {
  return { id: day.id, storeId: day.store_id, businessDate: dateText(day.business_date), timezone: day.timezone,
    cutoff: String(day.cutoff_local_time).slice(0, 5), periodStart: day.period_start, periodEnd: day.period_end, reportingCutoff: day.reporting_cutoff, status: day.status,
    closingStartedAt: day.closing_started_at, closedAt: day.closed_at, zReportId: day.z_report_id, version: day.version };
}

const stripSensitive = (body) => ({ ...body, cash: { ...body.cash, perSession: undefined }, cashDifferences: body.cashDifferences.map((row) => ({ context: row.context, shortages: row.shortages,
  overages: row.overages })), sources: undefined });

// The outlet's current business day, and earlier days that are still not closed (so yesterday can be closed after today has begun).
export async function getDayEndContext(client, context, { storeId = null, businessDate = null } = {}) {
  if (!mayView(context)) throw dayError(403, "POS_DAY_END_PERMISSION_DENIED", "You cannot view day-end reports.");
  let outlet = storeId;
  if (!outlet) {
    const stores = await accessiblePosStoreIds(client, context);
    outlet = (await client.query(`SELECT id FROM tenant.pos_stores WHERE organization_id = $1 ${stores ? "AND id = ANY($2::uuid[])" : ""} ORDER BY name LIMIT 1`,
      stores ? [context.organizationId, stores] : [context.organizationId])).rows[0]?.id;
    if (!outlet) throw dayError(404, "POS_DAY_END_DAY_INVALID", "No outlet to report on.");
  }
  const { day, store } = await resolveOutletBusinessDay(client, context, outlet, businessDate);
  const unclosed = (await client.query(`SELECT * FROM tenant.pos_business_days WHERE organization_id = $1 AND store_id = $2 AND status <> 'CLOSED' AND id <> $3 ORDER BY business_date DESC LIMIT 14`,
    [context.organizationId, store.id, day.id])).rows.map(dayView);
  return { outlet: { id: store.id, code: store.code, name: store.name, timezone: store.timezone, cutoff: store.cutoff.slice(0, 5), currency: store.currency }, day: dayView(day), unclosed,
    can: { preview: mayView(context), prepare: mayPrepare(context), finalize: mayFinalize(context), approve: mayApprove(context), sensitive: seesSensitive(context) } };
}

// The X report: read-only, any number of times, as at now — figures, exceptions and the preview hash; nothing is written, no number is used.
export async function buildXReport(client, context, dayId) {
  if (!mayView(context)) throw dayError(403, "POS_DAY_END_PERMISSION_DENIED", "You cannot view day-end reports.");
  const { day, store } = await loadDay(client, context, dayId);
  if (day.status === "CLOSED") return { kind: "Z", day: dayView(day), zReportId: day.z_report_id };
  const built = await buildSnapshot(client, context, day, store);
  return { kind: "X", day: dayView(day), asOf: new Date().toISOString(), previewHash: built.previewHash,
    report: seesSensitive(context) ? built.body : stripSensitive(built.body), readiness: summarize(built.exceptions, await storedExceptions(client, context, day), built.previewHash) };
}

async function storedExceptions(client, context, day) {
  return (await client.query(`SELECT exception.*, requester.full_name AS requested_by_name, approver.full_name AS approved_by_name FROM tenant.pos_day_end_exceptions exception
      LEFT JOIN public.users requester ON requester.id = exception.requested_by LEFT JOIN public.users approver ON approver.id = exception.approved_by
     WHERE exception.organization_id = $1 AND exception.business_day_id = $2`, [context.organizationId, day.id])).rows;
}

// Blocking, approvable (and whether each is approved for exactly these figures) and tracked — and whether the day can be finalized.
function summarize(found, stored, previewHash) {
  const byKey = new Map(stored.map((row) => [`${row.exception_code}:${row.source_id}`, row]));
  const items = found.map((item) => {
    const row = byKey.get(`${item.code}:${item.sourceId}`);
    const approved = item.severity === "APPROVABLE" && row?.status === "APPROVED";
    return { ...item, id: row?.id ?? null, status: row?.status === "RESOLVED" ? "OPEN" : row?.status ?? (item.severity === "TRACKED" ? "MANAGED" : "OPEN"),
      approvedBy: row?.approved_by_name ?? null, requestedBy: row?.requested_by_name ?? null, approvalCurrent: approved && row.approved_preview_hash === previewHash };
  });
  const blocking = items.filter((item) => item.severity === "BLOCKING");
  const approvable = items.filter((item) => item.severity === "APPROVABLE");
  const pending = approvable.filter((item) => !item.approvalCurrent);
  return { ready: !blocking.length && !pending.length, blocking: blocking.length, awaitingApproval: pending.length, staleApprovals: approvable.filter((item) => item.status === "APPROVED" && !item.approvalCurrent).length,
    tracked: items.filter((item) => item.severity === "TRACKED").length, items };
}

// Record the exceptions found now (and mark the ones that disappeared as resolved), and move the day to BLOCKED or READY_TO_FINALIZE.
async function persistReadiness(client, context, day, built) {
  const stored = await storedExceptions(client, context, day);
  const seen = new Set();
  for (const item of built.exceptions) {
    seen.add(`${item.code}:${item.sourceId}`);
    await client.query(
      `INSERT INTO tenant.pos_day_end_exceptions (organization_id, business_day_id, source_type, source_id, exception_code, severity, label, exposure_amount, status, owner_reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (organization_id, business_day_id, exception_code, source_id) DO UPDATE SET label = EXCLUDED.label, exposure_amount = EXCLUDED.exposure_amount, owner_reference = EXCLUDED.owner_reference,
         status = CASE WHEN tenant.pos_day_end_exceptions.status = 'RESOLVED' THEN EXCLUDED.status ELSE tenant.pos_day_end_exceptions.status END, resolved_at = NULL, updated_at = now()`,
      [context.organizationId, day.id, item.sourceType, item.sourceId, item.code, item.severity, item.label, item.exposure, item.severity === "TRACKED" ? "MANAGED" : "OPEN", item.owner]);
  }
  for (const row of stored.filter((entry) => entry.status !== "RESOLVED" && !seen.has(`${entry.exception_code}:${entry.source_id}`))) {
    await client.query(`UPDATE tenant.pos_day_end_exceptions SET status = 'RESOLVED', resolution_reference = 'Cleared at re-check', resolved_at = now(), updated_at = now() WHERE id = $1`, [row.id]);
  }
  const summary = summarize(built.exceptions, await storedExceptions(client, context, day), built.previewHash);
  if (["CLOSING", "BLOCKED", "READY_TO_FINALIZE"].includes(day.status)) {
    const next = summary.ready ? "READY_TO_FINALIZE" : "BLOCKED";
    await client.query(`UPDATE tenant.pos_business_days SET status = $3, last_preview_hash = $4, last_evaluated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, day.id, next, built.previewHash]);
  }
  return summary;
}

// Readiness: the exceptions recorded against the day and whether it can be finalized (for those preparing the close).
export async function getDayEndReadiness(client, context, dayId) {
  if (!mayPrepare(context) && !mayApprove(context)) throw dayError(403, "POS_DAY_END_PERMISSION_DENIED");
  const { day, store } = await loadDay(client, context, dayId, { lock: true });
  if (day.status === "CLOSED") return { day: dayView(day), closed: true, zReportId: day.z_report_id };
  const built = await buildSnapshot(client, context, day, store);
  const readiness = await persistReadiness(client, context, day, built);
  const fresh = (await client.query(`SELECT * FROM tenant.pos_business_days WHERE id = $1`, [day.id])).rows[0];
  return { day: dayView(fresh), previewHash: built.previewHash, readiness };
}

// ------------------------------------------------------------------ closing: begin, approval, finalize, recovery

// Start closing the day (no effect on selling — the next day's sales go on). input: expectedVersion?.
export async function beginDayEndClosing(client, context, dayId, input = {}) {
  if (!mayPrepare(context)) throw dayError(403, "POS_DAY_END_PERMISSION_DENIED");
  const { day } = await loadDay(client, context, dayId, { lock: true });
  if (day.status === "CLOSED") throw dayError(409, "POS_DAY_END_ALREADY_CLOSED", undefined, { zReportId: day.z_report_id });
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(day.version)) throw dayError(409, "POS_DAY_END_VERSION_CONFLICT");
  if (day.status === "OPEN" || day.status === "RECOVERY_REQUIRED") {
    await client.query(`UPDATE tenant.pos_business_days SET status = 'CLOSING', closing_started_at = COALESCE(closing_started_at, now()), closing_started_by = COALESCE(closing_started_by, $3)
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, day.id, context.userId]);
    await event(client, context, day.id, "pos.day_end.closing_started", {});
  }
  return getDayEndReadiness(client, context, day.id);
}

// Ask for approval of the approvable exceptions (inventory, invoice, document sequence, finance), for exactly the figures as they are now.
// input: note.
export async function requestDayEndApproval(client, context, dayId, input = {}) {
  if (!mayPrepare(context)) throw dayError(403, "POS_DAY_END_PERMISSION_DENIED");
  const current = await getDayEndReadiness(client, context, dayId);
  if (current.closed) throw dayError(409, "POS_DAY_END_ALREADY_CLOSED");
  const note = text(input.note);
  if (!note) throw dayError(400, "POS_DAY_END_APPROVAL_REQUIRED", "Say how each exception will be handled.");
  const open = current.readiness.items.filter((item) => item.severity === "APPROVABLE" && !item.approvalCurrent);
  if (!open.length) throw dayError(409, "POS_DAY_END_APPROVAL_INVALID", "Nothing needs approval.");
  await client.query(
    `UPDATE tenant.pos_day_end_exceptions SET status = 'APPROVAL_REQUESTED', requested_by = $3, requested_at = now(), request_note = $4, approved_by = NULL, approved_at = NULL,
            approved_preview_hash = NULL, updated_at = now()
      WHERE organization_id = $1 AND business_day_id = $2 AND severity = 'APPROVABLE' AND status <> 'RESOLVED' AND id = ANY($5::uuid[])`,
    [context.organizationId, dayId, context.userId, note, open.map((item) => item.id)]);
  await event(client, context, dayId, "pos.day_end.approval_requested", { exceptions: open.length, previewHash: current.previewHash });
  return getDayEndReadiness(client, context, dayId);
}

// Approve the requested exceptions — someone other than the requester, for exactly the figures they reviewed (input.previewHash): any change
// to the figures afterwards voids the approval. input: previewHash, note.
export async function approveDayEndExceptions(client, context, dayId, input = {}) {
  if (!mayApprove(context)) throw dayError(403, "POS_DAY_END_PERMISSION_DENIED", "You cannot approve day-end exceptions.");
  const current = await getDayEndReadiness(client, context, dayId);
  if (current.closed) throw dayError(409, "POS_DAY_END_ALREADY_CLOSED");
  if (String(input.previewHash ?? "") !== current.previewHash) throw dayError(409, "POS_DAY_END_REPORT_STALE");
  const requested = (await client.query(`SELECT id, requested_by FROM tenant.pos_day_end_exceptions WHERE organization_id = $1 AND business_day_id = $2 AND status = 'APPROVAL_REQUESTED'`,
    [context.organizationId, dayId])).rows;
  if (!requested.length) throw dayError(409, "POS_DAY_END_APPROVAL_INVALID", "No exception is waiting for approval.");
  if (requested.some((row) => row.requested_by === context.userId)) throw dayError(403, "POS_DAY_END_SELF_APPROVAL");
  await client.query(
    `UPDATE tenant.pos_day_end_exceptions SET status = 'APPROVED', approved_by = $3, approved_at = now(), approval_note = $4, approved_preview_hash = $5, updated_at = now()
      WHERE organization_id = $1 AND business_day_id = $2 AND status = 'APPROVAL_REQUESTED'`, [context.organizationId, dayId, context.userId, text(input.note), current.previewHash]);
  await event(client, context, dayId, "pos.day_end.exceptions_approved", { count: requested.length, previewHash: current.previewHash });
  return getDayEndReadiness(client, context, dayId);
}

function zResult(report, day) {
  return { businessDayId: day.id, status: "CLOSED", zReportId: report.id, zReportNumber: report.report_number, businessDate: dayView(day).businessDate, finalizedAt: report.finalized_at,
    snapshotHash: report.snapshot_hash, managedExceptions: (report.snapshot?.exceptions ?? []).filter((row) => row.severity !== "BLOCKING").length,
    checks: { shiftsClosed: report.snapshot?.shifts ? `${report.snapshot.shifts.closed}/${report.snapshot.shifts.total}` : null,
      blockingExceptions: 0, approvedExceptions: (report.snapshot?.exceptions ?? []).filter((row) => row.severity === "APPROVABLE").length,
      trackedObligations: (report.snapshot?.exceptions ?? []).filter((row) => row.severity === "TRACKED").length } };
}

// Finalize: one Z report per business day (the day row is locked; a unique index backs it), from figures that still match the ones reviewed,
// with no blocking exception and every approvable one approved for exactly these figures. A repeated key returns the same report.
// input: expectedVersion, expectedPreviewHash, idempotencyKey.
export async function finalizeZReport(client, context, dayId, input = {}) {
  if (!mayFinalize(context)) throw dayError(403, "POS_DAY_END_PERMISSION_DENIED");
  const key = text(input.idempotencyKey, 120);
  if (!key) throw dayError(400, "POS_DAY_END_OUTCOME_UNKNOWN", "Retry Day-End from the Day-End screen (a request key is needed).");
  const replay = (await client.query(`SELECT * FROM tenant.pos_day_end_reports WHERE organization_id = $1 AND idempotency_key = $2`, [context.organizationId, key])).rows[0];
  if (replay) {
    if (replay.business_day_id !== dayId) throw dayError(409, "POS_DAY_END_IDEMPOTENCY_CONFLICT");
    return zResult(replay, (await loadDay(client, context, dayId)).day);
  }
  const { day, store } = await loadDay(client, context, dayId, { lock: true });
  if (day.status === "CLOSED") throw dayError(409, "POS_DAY_END_ALREADY_CLOSED", undefined, { zReportId: day.z_report_id });
  if (!["CLOSING", "BLOCKED", "READY_TO_FINALIZE"].includes(day.status)) throw dayError(409, "POS_DAY_END_NOT_CLOSING");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(day.version)) throw dayError(409, "POS_DAY_END_VERSION_CONFLICT");
  const now = new Date();
  const built = await buildSnapshot(client, context, day, store, now);
  if (String(input.expectedPreviewHash ?? "") !== built.previewHash) throw dayError(409, "POS_DAY_END_REPORT_STALE", undefined, { previewHash: built.previewHash });
  const readiness = summarize(built.exceptions, await storedExceptions(client, context, day), built.previewHash);
  const blocking = readiness.items.find((item) => item.severity === "BLOCKING");
  if (blocking) throw dayError(409, EXCEPTIONS[blocking.code].error, undefined, { exceptions: readiness.items.filter((item) => item.severity === "BLOCKING") });
  const unapproved = readiness.items.find((item) => item.severity === "APPROVABLE" && !item.approvalCurrent);
  if (unapproved) throw dayError(409, unapproved.status === "APPROVED" ? "POS_DAY_END_APPROVAL_INVALID" : "POS_DAY_END_APPROVAL_REQUIRED", undefined,
    { exceptions: readiness.items.filter((item) => item.severity === "APPROVABLE" && !item.approvalCurrent) });
  const businessDate = dayView(day).businessDate;
  const legacy = (await client.query(
    `SELECT id, status FROM tenant.pos_day_end_reports WHERE organization_id = $1 AND store_id = $2 AND business_date = $3 AND scope_type = 'business_day' AND status <> 'void' AND terminal_id IS NULL`,
    [context.organizationId, store.id, businessDate])).rows[0];
  if (legacy?.status === "closed") throw dayError(409, "POS_DAY_END_ALREADY_CLOSED", "A day-end report was already closed for this outlet and date.", { zReportId: legacy.id });
  // An unlocked draft from the earlier day-end flow is superseded by the Z report.
  if (legacy) await client.query(`UPDATE tenant.pos_day_end_reports SET status = 'void', updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, legacy.id]);
  const number = await nextDocumentNumber(client, context, { documentType: "pos_day_end_report", prefix: "Z" });
  const body = { ...built.body, closing: { finalizedBy: (await client.query(`SELECT full_name FROM public.users WHERE id = $1`, [context.userId])).rows[0]?.full_name ?? null,
    finalizedAt: now.toISOString(), reportNumber: number, previewHash: built.previewHash, earlyClose: built.end < new Date(day.period_end) } };
  const s = built.body;
  const tenderTotals = s.collections.byMethod.map((row) => ({ method: row.method, amount: row.amount, count: row.count }));
  const report = (await client.query(
    `INSERT INTO tenant.pos_day_end_reports (organization_id, store_id, terminal_id, scope_type, business_date, status, report_number, sale_count, gross_sales_total, discount_total, tax_total,
       net_sales_total, rounding_total, grand_sales_total, return_count, return_total, tender_totals, opening_cash_total, paid_in_total, paid_out_total, expected_cash_total, counted_cash_total,
       cash_variance_total, lineage, outstanding_exceptions, generated_by, generated_at, reviewed_by, reviewed_at, finalized_by, finalized_at, business_day_id, report_version, currency_code,
       period_start, period_end, snapshot, snapshot_hash, preview_hash, source_watermarks, idempotency_key)
     VALUES ($1, $2, NULL, 'business_day', $3, 'closed', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17, $18, $19, $20, $21::jsonb, $22::jsonb, $23, $24, $23, $24, $23, $24,
       $25, $26, $27, $28, $29, $30::jsonb, $31, $32, $33::jsonb, $34) RETURNING *`,
    [context.organizationId, store.id, businessDate, number, s.sales.count, s.sales.gross, s.sales.totalDiscounts, s.sales.taxCharged, s.sales.netAfterReturns, s.sales.rounding,
      s.sales.taxInclusiveConsideration, s.returns.count, s.returns.value, JSON.stringify(tenderTotals), s.cash.openingFloats, s.cash.cashMovementIn, s.cash.cashMovementOut, s.cash.expected,
      s.cash.sessions ? s.cash.counted : null, s.cash.netVariance,
      JSON.stringify({ shiftIds: built.data.reportedShiftIds, saleIds: built.data.sales.map((row) => row.id), returnIds: built.data.returns.map((row) => row.id), cashMovementIds: built.data.movementIds }),
      JSON.stringify(s.exceptions.filter((row) => row.severity !== "BLOCKING")), context.userId, now, day.id, SNAPSHOT_VERSION, store.currency, day.period_start, built.end,
      JSON.stringify(body), hash(body), built.previewHash, JSON.stringify(s.sources), key])).rows[0];
  await client.query(
    `UPDATE tenant.pos_business_days SET status = 'CLOSED', closed_at = $3, closed_by = $4, z_report_id = $5, reporting_cutoff = $6, last_preview_hash = $7 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, day.id, now, context.userId, report.id, built.end, built.previewHash]);
  await persistReadiness(client, context, { ...day, status: "CLOSED" }, built);
  await event(client, context, day.id, "pos.day_end.finalized", { zReportId: report.id, number, previewHash: built.previewHash, snapshotHash: report.snapshot_hash,
    approved: readiness.items.filter((item) => item.severity === "APPROVABLE").length, tracked: readiness.tracked });
  // The closed day is the posting point for its sales and returns: they post to the accounts now, each on its own. One that cannot post
  // (an account not chosen yet …) stays visible in Accounting › Automatic postings and is retried there; it never holds up the close.
  await client.query("SAVEPOINT pos_day_end_auto_posting");
  try {
    await postPosDayEndReportToAccounting(client, posPostingContext(context), report.id);
    await client.query("RELEASE SAVEPOINT pos_day_end_auto_posting");
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT pos_day_end_auto_posting");
    await client.query("RELEASE SAVEPOINT pos_day_end_auto_posting");
  }
  return zResult(report, { ...day, status: "CLOSED" });
}

// What a lost answer would have said: the day's status and its Z report, if it was finalized.
export async function recoverDayEndFinalization(client, context, dayId) {
  if (!mayView(context)) throw dayError(403, "POS_DAY_END_PERMISSION_DENIED");
  const { day } = await loadDay(client, context, dayId);
  if (day.status !== "CLOSED") return { closed: false, day: dayView(day) };
  const report = (await client.query(`SELECT * FROM tenant.pos_day_end_reports WHERE organization_id = $1 AND id = $2`, [context.organizationId, day.z_report_id])).rows[0];
  return { closed: true, day: dayView(day), result: zResult(report, day) };
}

// ------------------------------------------------------------------ the Z report afterwards: view, history, prints, adjustments

async function loadZReport(client, context, reportId) {
  if (!mayView(context)) throw dayError(403, "POS_DAY_END_PERMISSION_DENIED", "You cannot view day-end reports.");
  if (!UUID.test(String(reportId ?? ""))) throw dayError(404, "POS_Z_REPORT_NOT_FOUND");
  const report = (await client.query(`SELECT * FROM tenant.pos_day_end_reports WHERE organization_id = $1 AND id = $2 AND business_day_id IS NOT NULL`, [context.organizationId, reportId])).rows[0];
  if (!report) throw dayError(404, "POS_Z_REPORT_NOT_FOUND");
  try { await assertPosStoreAccess(client, context, report.store_id); } catch { throw dayError(404, "POS_Z_REPORT_NOT_FOUND"); }
  return report;
}

// A finalized Z report exactly as frozen (verified against its hash); the summary copy leaves out per-drawer cash details.
export async function getZReport(client, context, reportId) {
  const report = await loadZReport(client, context, reportId);
  const sensitive = seesSensitive(context);
  const prints = (await client.query(`SELECT count(*)::int AS n FROM tenant.pos_z_report_prints WHERE organization_id = $1 AND z_report_id = $2`, [context.organizationId, report.id])).rows[0].n;
  const adjustments = (await client.query(`SELECT count(*)::int AS n FROM tenant.pos_z_report_adjustments WHERE organization_id = $1 AND z_report_id = $2`, [context.organizationId, report.id])).rows[0].n;
  return { id: report.id, number: report.report_number, businessDayId: report.business_day_id, businessDate: dateText(report.business_date),
    status: "CLOSED", finalizedAt: report.finalized_at, variant: sensitive ? "SENSITIVE" : "SUMMARY", snapshot: sensitive ? report.snapshot : stripSensitive(report.snapshot),
    snapshotHash: report.snapshot_hash, verified: hash(report.snapshot) === report.snapshot_hash, prints, adjustments, reconciliationStatus: report.reconciliation_status };
}

export async function getZReportForDay(client, context, dayId) {
  const { day } = await loadDay(client, context, dayId);
  if (day.status !== "CLOSED") throw dayError(404, "POS_Z_REPORT_NOT_FOUND", "This business day has no Z report yet.");
  return getZReport(client, context, day.z_report_id);
}

// Z reports, newest first. filters: storeId, from, to (business dates), q (report number), limit, offset.
export async function listZReports(client, context, filters = {}) {
  if (!mayView(context)) throw dayError(403, "POS_DAY_END_PERMISSION_DENIED", "You cannot view day-end reports.");
  const values = [context.organizationId];
  const where = ["report.organization_id = $1", "report.business_day_id IS NOT NULL"];
  const push = (value) => { values.push(value); return `$${values.length}`; };
  const stores = await accessiblePosStoreIds(client, context);
  if (stores) where.push(`report.store_id = ANY(${push(stores)}::uuid[])`);
  if (UUID.test(String(filters.storeId ?? ""))) where.push(`report.store_id = ${push(filters.storeId)}`);
  if (DATE.test(String(filters.from ?? ""))) where.push(`report.business_date >= ${push(filters.from)}::date`);
  if (DATE.test(String(filters.to ?? ""))) where.push(`report.business_date <= ${push(filters.to)}::date`);
  if (text(filters.q, 60)) where.push(`report.report_number ILIKE ${push(`%${text(filters.q, 60)}%`)}`);
  const limit = Math.min(Math.max(Number(filters.limit) || 30, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const total = (await client.query(`SELECT count(*)::int AS n FROM tenant.pos_day_end_reports report WHERE ${where.join(" AND ")}`, values)).rows[0].n;
  const rows = (await client.query(
    `SELECT report.id, report.report_number, report.business_date::text AS business_date, report.finalized_at, report.grand_sales_total, report.sale_count, report.return_total, report.cash_variance_total,
            report.reconciliation_status, report.snapshot -> 'exceptions' AS exceptions, store.name AS outlet, finalizer.full_name AS finalized_by,
            (SELECT count(*)::int FROM tenant.pos_z_report_adjustments adjustment WHERE adjustment.organization_id = report.organization_id AND adjustment.z_report_id = report.id) AS adjustments
       FROM tenant.pos_day_end_reports report JOIN tenant.pos_stores store ON store.organization_id = report.organization_id AND store.id = report.store_id
       LEFT JOIN public.users finalizer ON finalizer.id = report.finalized_by
      WHERE ${where.join(" AND ")} ORDER BY report.business_date DESC, report.finalized_at DESC LIMIT ${limit} OFFSET ${offset}`, values)).rows;
  return { total, rows: rows.map((row) => ({ id: row.id, number: row.report_number, businessDate: row.business_date, outlet: row.outlet, finalizedAt: row.finalized_at, finalizedBy: row.finalized_by,
    sales: row.sale_count, consideration: money(row.grand_sales_total), returns: money(row.return_total), cashVariance: money(row.cash_variance_total),
    tracked: (row.exceptions ?? []).filter((item) => item.severity === "TRACKED").length, approved: (row.exceptions ?? []).filter((item) => item.severity === "APPROVABLE").length,
    adjustments: row.adjustments, reconciliationStatus: row.reconciliation_status })) };
}

// Print or reprint (receipt-printer summary or A4): recorded; the content is the frozen snapshot. input: format, reason.
export async function recordZReportPrint(client, context, reportId, input = {}) {
  const report = await getZReport(client, context, reportId);
  const format = String(input.format ?? "A4").toUpperCase();
  if (!["THERMAL", "A4"].includes(format)) throw dayError(400, "POS_DAY_END_DOCUMENT_UNAVAILABLE", "Print on the receipt printer (THERMAL) or as a page (A4).");
  const reprint = report.prints > 0;
  const reason = text(input.reason, 300);
  const policy = (await client.query(`SELECT receipt_reprint_reason_required FROM tenant.pos_settings WHERE organization_id = $1`, [context.organizationId])).rows[0];
  if (reprint && policy?.receipt_reprint_reason_required && !reason) throw dayError(400, "POS_DAY_END_DOCUMENT_UNAVAILABLE", "Say why the Z report is printed again.");
  await client.query(`INSERT INTO tenant.pos_z_report_prints (organization_id, z_report_id, format, variant, is_reprint, reason, printed_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [context.organizationId, report.id, format, report.variant, reprint, reason, context.userId]);
  await event(client, context, report.businessDayId, reprint ? "pos.day_end.z_reprinted" : "pos.day_end.z_printed", { zReportId: report.id, format, reason });
  return { ...report, prints: report.prints + 1, printed: { format, reprint } };
}

function adjustmentView(row) {
  return { id: row.id, category: row.adjustment_category, sourceType: row.source_type, sourceId: row.source_id, discoveredAt: row.discovered_at, monetaryEffect: row.monetary_effect === null ? null : money(row.monetary_effect),
    description: row.description, previousState: row.previous_state, currentState: row.current_state, financeReference: row.finance_reference, automatic: row.automatic,
    recordedBy: row.recorded_by_name ?? null };
}

// Late events for a finalized day: anything the snapshot carried as outstanding (a provider refund, a payment under recovery, an open cash
// difference) that has since moved on is linked as an automatic adjustment — once per new state. The snapshot itself never changes.
export async function syncZReportAdjustments(client, context, reportId) {
  const report = await loadZReport(client, context, reportId);
  const tracked = (report.snapshot?.exceptions ?? []).filter((row) => row.severity !== "BLOCKING");
  for (const item of tracked) {
    let current = null; let category = null; let effect = null;
    if (item.sourceType === "payment_refund_component") {
      const row = (await client.query(`SELECT status, successful_amount FROM tenant.payment_refund_components WHERE organization_id = $1 AND id = $2`, [context.organizationId, item.sourceId])).rows[0];
      if (row && ["succeeded", "failed", "cancelled"].includes(row.status)) { current = row.status; category = "LATE_REFUND_OUTCOME"; effect = row.status === "succeeded" ? money(row.successful_amount) : null; }
    } else if (item.sourceType === "pos_payment") {
      const row = (await client.query(`SELECT status, recovery_status, sale_id FROM tenant.pos_payments WHERE organization_id = $1 AND id = $2`, [context.organizationId, item.sourceId])).rows[0];
      const state = row ? `${row.status}${row.recovery_status ? `/${row.recovery_status}` : ""}${row.sale_id ? "/sale" : ""}` : null;
      if (row && (["failed", "voided", "refunded"].includes(row.status) || ["refunded", "resolved"].includes(row.recovery_status ?? "") || (row.status === "captured" && row.sale_id))) {
        current = state; category = "LATE_PAYMENT_OUTCOME"; effect = item.exposure;
      }
    } else if (item.sourceType === "pos_cash_difference") {
      const row = (await client.query(`SELECT case_status, resolution_type, finance_status FROM tenant.pos_cash_differences WHERE organization_id = $1 AND id = $2`, [context.organizationId, item.sourceId])).rows[0];
      if (row?.case_status === "RESOLVED") { current = `RESOLVED/${row.resolution_type}/${row.finance_status}`; category = "CASH_DIFFERENCE_RESOLVED"; effect = item.exposure; }
    } else if (item.sourceType === "pos_cash_custody_transfer") {
      const row = (await client.query(`SELECT status, variance_amount FROM tenant.pos_cash_custody_transfers WHERE organization_id = $1 AND id = $2`, [context.organizationId, item.sourceId])).rows[0];
      if (row?.status === "ACCEPTED") { current = `ACCEPTED${Number(row.variance_amount) ? ` (${money(row.variance_amount)})` : ""}`; category = "OTHER"; effect = row.variance_amount === null ? null : money(row.variance_amount); }
    }
    if (!current) continue;
    await client.query(
      `INSERT INTO tenant.pos_z_report_adjustments (organization_id, z_report_id, business_day_id, adjustment_category, source_type, source_id, monetary_effect, description, previous_state,
         current_state, automatic) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true) ON CONFLICT DO NOTHING`,
      [context.organizationId, report.id, report.business_day_id, category, item.sourceType, item.sourceId, effect, `${item.label} — now ${current.toLowerCase()}`, "outstanding at Day-End", current]);
  }
  return listZReportAdjustments(client, context, report.id);
}

export async function listZReportAdjustments(client, context, reportId) {
  const report = await loadZReport(client, context, reportId);
  return (await client.query(`SELECT adjustment.*, users.full_name AS recorded_by_name FROM tenant.pos_z_report_adjustments adjustment LEFT JOIN public.users ON users.id = adjustment.recorded_by
      WHERE adjustment.organization_id = $1 AND adjustment.z_report_id = $2 ORDER BY adjustment.created_at`, [context.organizationId, report.id])).rows.map(adjustmentView);
}

// A correction found after the close, recorded beside the report (what changed, its source, its money effect and Finance's reference).
// input: category, sourceType, sourceId?, monetaryEffect?, description, financeReference?.
export async function recordZReportAdjustment(client, context, reportId, input = {}) {
  if (!mayFinalize(context) && !mayApprove(context)) throw dayError(403, "POS_DAY_END_PERMISSION_DENIED", "Only a manager or Finance records a correction to a closed day.");
  const report = await loadZReport(client, context, reportId);
  const category = String(input.category ?? "").toUpperCase();
  if (!["INVOICE_CORRECTION", "INVENTORY_CORRECTION", "FINANCE_CORRECTION", "LATE_PAYMENT_OUTCOME", "LATE_REFUND_OUTCOME", "CASH_DIFFERENCE_RESOLVED", "OTHER"].includes(category))
    throw dayError(400, "POS_DAY_END_SNAPSHOT_ERROR", "Choose what kind of correction this is.");
  const description = text(input.description);
  const sourceType = text(input.sourceType, 60);
  if (!description || !sourceType) throw dayError(400, "POS_DAY_END_SNAPSHOT_ERROR", "Say what changed and which record it belongs to.");
  const effect = input.monetaryEffect === undefined || input.monetaryEffect === null || input.monetaryEffect === "" ? null : String(input.monetaryEffect).trim();
  if (effect !== null && !/^-?\d{1,14}(\.\d{1,2})?$/.test(effect)) throw dayError(400, "POS_DAY_END_SNAPSHOT_ERROR", "Give the money effect as an amount (negative for a reduction).");
  const row = (await client.query(
    `INSERT INTO tenant.pos_z_report_adjustments (organization_id, z_report_id, business_day_id, adjustment_category, source_type, source_id, monetary_effect, description, finance_reference, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [context.organizationId, report.id, report.business_day_id, category, sourceType, UUID.test(String(input.sourceId ?? "")) ? input.sourceId : null, effect, description, text(input.financeReference, 120),
      context.userId])).rows[0];
  await event(client, context, report.business_day_id, "pos.day_end.adjustment_recorded", { zReportId: report.id, adjustmentId: row.id, category });
  return adjustmentView(row);
}
