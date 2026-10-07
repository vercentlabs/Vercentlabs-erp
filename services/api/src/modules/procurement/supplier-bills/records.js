// Supplier bills, read side: one bill in full (lines with their tax components, order and receipt matching, payments, the vendor credits that corrected it,
// related documents, the accounting Finance posted, history), the list and its views, AP aging, the AP reconciliation of a bill, and the
// options the bill form needs. Every balance and status is read from Finance's records, never stored by Procurement.
import { add, decimal, formatDecimal, sub } from "../../../core/decimal.js";
import { poCan } from "../purchase-orders/access.js";
import { checkDuplicateSupplierInvoice, loadBill, requireBillAccess } from "./bills.js";
import { BILL_PERMISSIONS, BILL_VIEWS, SOURCE_TYPES, dayOf, documentStatus, dueStatus, isUuid, matchingResult, paymentStatus, text } from "./constants.js";
import { creditedOnBillLines } from "../vendor-credits/credits.js";
import { companyToday, readTermSnapshot } from "../../../core/payment-terms/index.js";
import { getSupplierBillPaymentSchedule, getSupplierInstallmentAging } from "../payment-terms/schedule.js";
import { TWO_WAY_SQL } from "./matching.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
// The company's local date, and a bill's earliest open instalment: a bill is overdue when any instalment still owed is past due.
const today = (client, context) => companyToday(client, context.organizationId);
const COMPANY_TODAY_SQL = `(now() AT TIME ZONE COALESCE(NULLIF((SELECT organization.timezone FROM public.organizations organization WHERE organization.id = bill.organization_id), ''), 'UTC'))::date`;
const NEXT_DUE_SQL = `COALESCE((SELECT min(schedule.due_date) FROM tenant.accounting_vendor_bill_schedules schedule WHERE schedule.organization_id = bill.organization_id
    AND schedule.vendor_bill_id = bill.id AND schedule.outstanding_amount > 0), bill.due_date)`;
const POSTED_SQL = `bill.status IN ('posted', 'partially_paid', 'paid', 'overdue', 'disputed')`;
const VIEW_SQL = {
  all: "", draft: " AND bill.status IN ('draft', 'pending_approval', 'approved')", posted: ` AND ${POSTED_SQL}`,
  unpaid: ` AND ${POSTED_SQL} AND bill.outstanding_amount > 0 AND bill.outstanding_amount >= bill.grand_total`,
  partially_paid: ` AND ${POSTED_SQL} AND bill.outstanding_amount > 0 AND bill.outstanding_amount < bill.grand_total`,
  paid: ` AND ${POSTED_SQL} AND bill.outstanding_amount <= 0`, overdue: ` AND ${POSTED_SQL} AND bill.outstanding_amount > 0 AND ${NEXT_DUE_SQL} < ${COMPANY_TODAY_SQL}`,
  po_based: " AND bill.source_purchase_order_id IS NOT NULL", direct: " AND bill.source_type = 'direct'",
  // Matching issues: a mismatch, a draft not checked since its order changed, an accepted exception, a pending receipt, an accepted duplicate.
  matching_issues: ` AND bill.source_purchase_order_id IS NOT NULL AND ((${TWO_WAY_SQL}) IN ('mismatch', 'not_checked', 'approved_exception') OR bill.matching_status = 'pending'
                     OR bill.duplicate_override_reason IS NOT NULL)`,
  reversed_cancelled: " AND bill.status IN ('reversed', 'cancelled')",
  // Bills of orders billed in part: some quantity billed by posted bills, some still to bill.
  partially_billed_pos: ` AND bill.source_purchase_order_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM tenant.purchase_order_line_status status WHERE status.organization_id = bill.organization_id AND status.purchase_order_id = bill.source_purchase_order_id AND status.posted_billed_quantity > 0)
    AND EXISTS (SELECT 1 FROM tenant.purchase_order_line_status status WHERE status.organization_id = bill.organization_id AND status.purchase_order_id = bill.source_purchase_order_id AND status.posted_billed_quantity < status.bill_target_quantity)`,
};

const MATCH_FILTERS = ["matched", "mismatch", "approved_exception", "not_checked", "not_applicable"];
// Matching issue categories: open (not accepted) discrepancies of the bill's current evaluation, or a duplicate supplier invoice.
const ISSUE_CODES = {
  missing_grn: ["MISSING_GOODS_RECEIPT"], insufficient_received: ["INSUFFICIENT_RECEIVED_QUANTITY", "RECEIPT_ALREADY_ALLOCATED", "REJECTED_RETURNED_GOODS", "INVALID_GRN_STATUS"],
  pending_quality: ["INSUFFICIENT_ACCEPTED_QUANTITY"], price_mismatch: ["PRICE_MISMATCH", "DISCOUNT_MISMATCH"], quantity_exceeded: ["QUANTITY_EXCEEDED", "VALUE_EXCEEDED"],
  product_mismatch: ["PRODUCT_MISMATCH", "UNMATCHED_PO_LINE", "UOM_MISMATCH"], unresolved_variance: ["PRICE_MISMATCH", "DISCOUNT_MISMATCH", "UNAUTHORIZED_CHARGE"],
};
const states = (row, day) => ({ documentStatus: documentStatus(row), paymentStatus: paymentStatus(row), dueStatus: dueStatus(row, day), matchingResult: matchingResult(row) });

// filters: view, source (purchase_order | direct), documentStatus (draft | posted | cancelled | reversed), paymentStatus (unpaid |
// partially_paid | paid), due (not_due | overdue), matchingResult (matched | mismatch | approved_exception | not_checked | not_applicable), issue (missing_grn | insufficient_received |
// pending_quality | price_mismatch | quantity_exceeded | product_mismatch | duplicate_invoice | unresolved_variance), supplierId, purchaseOrderId, goodsReceiptId, sourceBillId, expenseCategoryId, dateFrom, dateTo, search (also the lines'
// descriptions and expense categories).
export async function listSupplierBills(client, context, filters = {}) {
  requireBillAccess(context);
  const values = [context.organizationId];
  const bind = (value) => `$${values.push(value)}`;
  let where = " AND bill.bill_type = 'bill'";
  where += VIEW_SQL[filters.view] ?? "";
  if (filters.source === "direct") where += " AND bill.source_type = 'direct'";
  else if (filters.source === "purchase_order") where += " AND bill.source_purchase_order_id IS NOT NULL";
  where += { draft: " AND bill.status IN ('draft', 'pending_approval', 'approved')", posted: ` AND ${POSTED_SQL}`, cancelled: " AND bill.status = 'cancelled'", reversed: " AND bill.status = 'reversed'" }[filters.documentStatus] ?? "";
  where += { unpaid: ` AND ${POSTED_SQL} AND bill.outstanding_amount >= bill.grand_total AND bill.outstanding_amount > 0`,
    partially_paid: ` AND ${POSTED_SQL} AND bill.outstanding_amount > 0 AND bill.outstanding_amount < bill.grand_total`, paid: ` AND ${POSTED_SQL} AND bill.outstanding_amount <= 0` }[filters.paymentStatus] ?? "";
  where += { overdue: ` AND ${POSTED_SQL} AND bill.outstanding_amount > 0 AND ${NEXT_DUE_SQL} < ${COMPANY_TODAY_SQL}`,
    not_due: ` AND ${POSTED_SQL} AND bill.outstanding_amount > 0 AND ${NEXT_DUE_SQL} >= ${COMPANY_TODAY_SQL}` }[filters.due] ?? "";
  if (isUuid(filters.expenseCategoryId))
    where += ` AND EXISTS (SELECT 1 FROM tenant.accounting_vendor_bill_lines line WHERE line.organization_id = bill.organization_id AND line.vendor_bill_id = bill.id AND line.expense_category_id = ${bind(filters.expenseCategoryId)})`;
  // 2-Way Matching result: matched | mismatch | approved_exception | not_checked | not_applicable.
  if (MATCH_FILTERS.includes(filters.matchingResult)) where += ` AND (${TWO_WAY_SQL}) = ${bind(filters.matchingResult)}`;
  if (ISSUE_CODES[filters.issue])
    where += ` AND bill.status IN ('draft', 'pending_approval', 'approved') AND EXISTS (SELECT 1 FROM tenant.supplier_bill_match_evaluations issue_eval, jsonb_array_elements(issue_eval.discrepancies) issue
      WHERE issue_eval.organization_id = bill.organization_id AND issue_eval.id = bill.two_way_evaluation_id AND NOT COALESCE((issue->>'approved')::boolean, false)
        AND issue->>'code' = ANY(${bind(ISSUE_CODES[filters.issue])}::text[]))`;
  else if (filters.issue === "duplicate_invoice")
    where += ` AND EXISTS (SELECT 1 FROM tenant.accounting_vendor_bills twin WHERE twin.organization_id = bill.organization_id AND twin.party_id = bill.party_id AND twin.id <> bill.id
      AND twin.bill_type = 'bill' AND twin.status NOT IN ('cancelled', 'reversed') AND upper(regexp_replace(COALESCE(twin.supplier_invoice_reference, twin.supplier_invoice_number, ''), '\\s+', '', 'g'))
        = upper(regexp_replace(COALESCE(bill.supplier_invoice_reference, bill.supplier_invoice_number, ''), '\\s+', '', 'g')) AND COALESCE(bill.supplier_invoice_reference, bill.supplier_invoice_number, '') <> '')`;
  if (isUuid(filters.supplierId)) where += ` AND bill.supplier_id = ${bind(filters.supplierId)}`;
  if (isUuid(filters.purchaseOrderId)) where += ` AND bill.source_purchase_order_id = ${bind(filters.purchaseOrderId)}`;
  if (isUuid(filters.sourceBillId)) where += ` AND bill.source_bill_id = ${bind(filters.sourceBillId)}`;
  if (isUuid(filters.goodsReceiptId))
    where += ` AND EXISTS (SELECT 1 FROM tenant.supplier_bill_receipt_allocations allocation JOIN tenant.goods_receipt_lines line ON line.organization_id = allocation.organization_id
      AND line.id = allocation.goods_receipt_line_id WHERE allocation.organization_id = bill.organization_id AND allocation.vendor_bill_id = bill.id AND line.goods_receipt_id = ${bind(filters.goodsReceiptId)})`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateFrom ?? ""))) where += ` AND bill.bill_date >= ${bind(filters.dateFrom)}::date`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateTo ?? ""))) where += ` AND bill.bill_date <= ${bind(filters.dateTo)}::date`;
  const search = text(filters.search, 120);
  if (search) {
    const term = bind(`%${search}%`);
    where += ` AND (bill.bill_number ILIKE ${term} OR COALESCE(bill.supplier_invoice_reference, bill.supplier_invoice_number) ILIKE ${term} OR party.display_name ILIKE ${term} OR po.purchase_order_number ILIKE ${term}
      OR EXISTS (SELECT 1 FROM tenant.accounting_vendor_bill_lines line LEFT JOIN tenant.expense_categories category ON category.organization_id = line.organization_id AND category.id = line.expense_category_id
                  WHERE line.organization_id = bill.organization_id AND line.vendor_bill_id = bill.id AND (line.description ILIKE ${term} OR category.name ILIKE ${term})))`;
  }
  const { rows } = await client.query(
    `SELECT bill.*, party.display_name AS supplier_name, po.purchase_order_number, source.bill_number AS source_bill_number, ${TWO_WAY_SQL} AS two_way, ${NEXT_DUE_SQL} AS next_due_date,
            (SELECT evaluation.discrepancies FROM tenant.supplier_bill_match_evaluations evaluation WHERE evaluation.organization_id = bill.organization_id
                AND evaluation.id = bill.two_way_evaluation_id) AS match_discrepancies,
            (SELECT COALESCE(sum(allocation.allocated_amount), 0) FROM tenant.accounting_vendor_payment_allocations allocation
              WHERE allocation.organization_id = bill.organization_id AND allocation.vendor_bill_id = bill.id AND NOT EXISTS (SELECT 1 FROM tenant.accounting_vendor_payment_allocation_reversals reversal WHERE reversal.organization_id = allocation.organization_id AND reversal.allocation_id = allocation.id)) AS paid,
            (SELECT COALESCE(sum(credit.allocated_amount), 0) FROM tenant.accounting_vendor_credit_allocations credit
              WHERE credit.organization_id = bill.organization_id AND credit.vendor_bill_id = bill.id) AS credited
       FROM tenant.accounting_vendor_bills bill
       JOIN tenant.business_parties party ON party.organization_id = bill.organization_id AND party.id = bill.party_id
       LEFT JOIN tenant.purchase_orders po ON po.organization_id = bill.organization_id AND po.id = bill.source_purchase_order_id
       LEFT JOIN tenant.accounting_vendor_bills source ON source.organization_id = bill.organization_id AND source.id = bill.source_bill_id
      WHERE bill.organization_id = $1${where} ORDER BY bill.bill_date DESC, bill.created_at DESC LIMIT 300`, values);
  const day = await today(client, context);
  return rows.map((row) => ({
    id: row.id, billNumber: row.bill_number, supplierInvoiceNumber: row.supplier_invoice_reference ?? row.supplier_invoice_number, supplierId: row.supplier_id, supplierName: row.supplier_name,
    supplierInvoiceDate: dayOf(row.bill_date), postingDate: dayOf(row.accounting_date), dueDate: dayOf(row.due_date), purchaseOrderId: row.source_purchase_order_id,
    purchaseOrderNumber: row.purchase_order_number, sourceType: row.source_type ?? (row.source_purchase_order_id ? "purchase_order" : "direct"), currencyCode: row.currency_code.trim(),
    invoiceTotal: dec(row.invoice_total && decimal(row.invoice_total) > 0n ? row.invoice_total : row.grand_total), netPayable: dec(row.grand_total), paid: dec(row.paid),
    credited: dec(row.credited), balanceDue: dec(row.outstanding_amount), sourceBillId: row.source_bill_id, sourceBillNumber: row.source_bill_number, status: row.status, ...states(row, day),
    twoWayResult: row.bill_type === "credit_note" ? "not_applicable" : row.two_way, ...discrepancySummary(row.match_discrepancies, row.two_way),
  }));
}
// The list's short discrepancy note: how many are open and the first one's label.
function discrepancySummary(entries, result) {
  const open = result === "mismatch" ? (entries ?? []).filter((entry) => !entry.approved) : [];
  return { discrepancyCount: open.length, discrepancy: open.length ? `${open[0].label}${open.length > 1 ? ` +${open.length - 1}` : ""}` : null };
}

// calculateSupplierBillBalance / getSupplierBillPaymentStatus / getSupplierBillOverdueStatus, from Finance's allocations.
export async function calculateSupplierBillBalance(client, context, billId) {
  const bill = await loadBill(client, context, billId);
  const day = await today(client, context);
  const settled = (await client.query(
    `SELECT (SELECT COALESCE(sum(allocation.allocated_amount), 0) FROM tenant.accounting_vendor_payment_allocations allocation WHERE allocation.organization_id = $1 AND allocation.vendor_bill_id = $2
               AND NOT EXISTS (SELECT 1 FROM tenant.accounting_vendor_payment_allocation_reversals reversal WHERE reversal.organization_id = allocation.organization_id AND reversal.allocation_id = allocation.id)) AS paid,
            (SELECT COALESCE(sum(allocated_amount), 0) FROM tenant.accounting_vendor_credit_allocations WHERE organization_id = $1 AND vendor_bill_id = $2) AS credited`,
    [context.organizationId, bill.id])).rows[0];
  return { total: dec(bill.grand_total), paid: dec(settled.paid), credited: dec(settled.credited), balance: dec(bill.outstanding_amount), ...states(bill, day) };
}
export const getSupplierBillPaymentStatus = async (client, context, billId) => (await calculateSupplierBillBalance(client, context, billId)).paymentStatus;
export const getSupplierBillOverdueStatus = async (client, context, billId) => (await calculateSupplierBillBalance(client, context, billId)).dueStatus;

// reconcileSupplierBill: the bill against Finance's AP ledger — the payable its journal booked, what payments and credits settled, what is left.
export async function reconcileSupplierBill(client, context, billId) {
  const bill = await loadBill(client, context, billId);
  const organizationId = context.organizationId;
  const posted = ["posted", "partially_paid", "paid", "overdue", "disputed"].includes(bill.status);
  const payable = bill.journal_entry_id ? (await client.query(
    `SELECT COALESCE(sum(line.credit_amount - line.debit_amount), 0) AS amount FROM tenant.accounting_journal_lines line
      WHERE line.organization_id = $1 AND line.journal_entry_id = $2 AND line.description LIKE 'Payable %'`, [organizationId, bill.journal_entry_id])).rows[0].amount : 0;
  const balance = await calculateSupplierBillBalance(client, context, bill.id);
  const schedules = (await client.query(`SELECT COALESCE(sum(outstanding_amount), 0) AS amount FROM tenant.accounting_vendor_bill_schedules WHERE organization_id = $1 AND vendor_bill_id = $2`,
    [organizationId, bill.id])).rows[0].amount;
  const sign = bill.bill_type === "credit_note" ? -1n : 1n;
  const expected = posted ? sub(sub(bill.grand_total, balance.paid), balance.credited) : decimal(bill.status === "reversed" || bill.status === "cancelled" ? 0 : bill.grand_total);
  const checks = {
    journalPayable: !posted || decimal(payable) * sign === decimal(bill.grand_total),
    settlement: !posted || expected === decimal(bill.outstanding_amount),
    schedules: !posted || decimal(schedules) === decimal(bill.outstanding_amount),
  };
  return { billId: bill.id, matched: Object.values(checks).every(Boolean), checks, journalPayable: dec(decimal(payable) * sign), total: dec(bill.grand_total), paid: balance.paid,
    credited: balance.credited, outstanding: dec(bill.outstanding_amount), schedulesOutstanding: dec(schedules) };
}

// getSupplierBillAging: what posted bills still owe, by how overdue (not due, 1–30, 31–60, 61–90, over 90 days), per supplier.
// getSupplierBillAging: AP aging by instalment due date, measured on the company's local date (see payment-terms/schedule.js).
export const getSupplierBillAging = (client, context, filters = {}) => getSupplierInstallmentAging(client, context, filters);

export async function journalOf(client, organizationId, entryId) {
  if (!entryId) return null;
  const entry = (await client.query(`SELECT id, entry_number, status, accounting_date FROM tenant.accounting_journal_entries WHERE organization_id = $1 AND id = $2`, [organizationId, entryId])).rows[0];
  if (!entry) return null;
  const lines = (await client.query(
    `SELECT line.description, line.debit_amount, line.credit_amount, line.base_debit_amount, line.base_credit_amount, account.code, account.name FROM tenant.accounting_journal_lines line
       JOIN tenant.accounting_accounts account ON account.organization_id = line.organization_id AND account.id = line.account_id
      WHERE line.organization_id = $1 AND line.journal_entry_id = $2 ORDER BY line.sequence`, [organizationId, entryId])).rows;
  return { id: entry.id, number: entry.entry_number, status: entry.status, date: dayOf(entry.accounting_date),
    lines: lines.map((line) => ({ account: `${line.code} · ${line.name}`, description: line.description, debit: dec(line.debit_amount), credit: dec(line.credit_amount),
      baseDebit: dec(line.base_debit_amount), baseCredit: dec(line.base_credit_amount) })) };
}

// getSupplierBillHistory: what Finance and Procurement recorded on the bill.
export async function getSupplierBillHistory(client, context, billId) {
  const bill = await loadBill(client, context, billId);
  const { rows } = await client.query(
    `SELECT event.id, event.event_type, event.from_status, event.to_status, event.metadata, event.occurred_at, users.full_name FROM tenant.accounting_events event
       LEFT JOIN public.users users ON users.id = event.actor_user_id WHERE event.organization_id = $1 AND event.entity_type IN ('vendor_bill', 'accounting_vendor_bill') AND event.entity_id = $2
      ORDER BY event.occurred_at DESC`, [context.organizationId, bill.id]);
  const label = (type) => ({ "accounting.vendor_bill.created": "Drafted", "accounting.vendor_bill.updated": "Draft changed", "accounting.vendor_bill.posted": "Posted to Accounts Payable",
    "accounting.vendor_bill.settled": "Payment allocated", "accounting.vendor_credit.applied": "Credit applied", "accounting.vendor_bill.cancelled": "Cancelled",
    "accounting.vendor_bill.reversed": "Reversed", "accounting.vendor_bill.payment_reversed": "Payment reversed", "accounting.vendor_credit.allocated": "Credit allocated",
    "accounting.vendor_bill.due_date_overridden": "Due date overridden" }[type] ?? type.replace(/^accounting\./, "").replace(/[._]/g, " "));
  return rows.map((row) => ({ id: row.id, type: row.event_type, summary: `${label(row.event_type)}${row.metadata?.dueDate ? ` (${row.metadata.computedDueDate} → ${row.metadata.dueDate})` : ""}${row.metadata?.reason ? `: ${row.metadata.reason}` : ""}`, from: row.from_status, to: row.to_status,
    at: row.occurred_at, actor: row.full_name }));
}

export async function getSupplierBill(client, context, billId) {
  const bill = await loadBill(client, context, billId);
  const organizationId = context.organizationId;
  const day = await today(client, context);
  const row = (await client.query(
    `SELECT bill.*, party.display_name AS supplier_name, po.purchase_order_number, po.status AS order_status, poster.full_name AS posted_by_name, creator.full_name AS created_by_name,
            reverser.full_name AS reversed_by_name, section.code AS section_code, section.name AS section_name, source.bill_number AS source_bill_number,
            purchase_return.return_number, overrider.full_name AS duplicate_override_by_name, ${NEXT_DUE_SQL} AS next_due_date
       FROM tenant.accounting_vendor_bills bill JOIN tenant.business_parties party ON party.organization_id = bill.organization_id AND party.id = bill.party_id
       LEFT JOIN tenant.purchase_orders po ON po.organization_id = bill.organization_id AND po.id = bill.source_purchase_order_id
       LEFT JOIN public.users poster ON poster.id = bill.posted_by LEFT JOIN public.users creator ON creator.id = bill.created_by LEFT JOIN public.users reverser ON reverser.id = bill.reversed_by
       LEFT JOIN public.users overrider ON overrider.id = bill.duplicate_override_by
       LEFT JOIN tenant.withholding_tax_sections section ON section.organization_id = bill.organization_id AND section.id = bill.withholding_section_id
       LEFT JOIN tenant.accounting_vendor_bills source ON source.organization_id = bill.organization_id AND source.id = bill.source_bill_id
       LEFT JOIN tenant.purchase_returns purchase_return ON purchase_return.organization_id = bill.organization_id AND purchase_return.id = bill.source_purchase_return_id
      WHERE bill.organization_id = $1 AND bill.id = $2`, [organizationId, bill.id])).rows[0];
  const lines = (await client.query(
    `SELECT line.*, account.code AS account_code, account.name AS account_name, order_line.line_number AS order_line_number, order_line.unit_price AS order_unit_price,
            order_line.ordered_quantity, variance.code AS variance_code, category.name AS category_name, center.name AS cost_center_name, department.name AS department_name
       FROM tenant.accounting_vendor_bill_lines line
       JOIN tenant.accounting_accounts account ON account.organization_id = line.organization_id AND account.id = line.expense_account_id
       LEFT JOIN tenant.accounting_accounts variance ON variance.organization_id = line.organization_id AND variance.id = line.variance_account_id
       LEFT JOIN tenant.purchase_order_lines order_line ON order_line.organization_id = line.organization_id AND order_line.id = line.purchase_order_line_id
       LEFT JOIN tenant.expense_categories category ON category.organization_id = line.organization_id AND category.id = line.expense_category_id
       LEFT JOIN public.cost_centers center ON center.id = line.cost_center_id LEFT JOIN public.departments department ON department.id = line.department_id
      WHERE line.organization_id = $1 AND line.vendor_bill_id = $2 ORDER BY line.sequence`, [organizationId, bill.id])).rows;
  const taxes = (await client.query(`SELECT * FROM tenant.supplier_bill_line_taxes WHERE organization_id = $1 AND vendor_bill_id = $2 ORDER BY created_at`, [organizationId, bill.id])).rows;
  const allocations = (await client.query(
    `SELECT allocation.vendor_bill_line_id, allocation.quantity, receipt_line.goods_receipt_id, receipt.receipt_number, receipt_line.line_number
       FROM tenant.supplier_bill_receipt_allocations allocation
       JOIN tenant.goods_receipt_lines receipt_line ON receipt_line.organization_id = allocation.organization_id AND receipt_line.id = allocation.goods_receipt_line_id
       JOIN tenant.goods_receipts receipt ON receipt.organization_id = receipt_line.organization_id AND receipt.id = receipt_line.goods_receipt_id
      WHERE allocation.organization_id = $1 AND allocation.vendor_bill_id = $2 ORDER BY receipt.receipt_number`, [organizationId, bill.id])).rows;
  const payments = (await client.query(
    `SELECT allocation.id, allocation.allocated_amount, allocation.bill_amount, allocation.allocated_at, reversal.reversed_at, payment.id AS payment_id, payment.payment_number,
            payment.payment_date, payment.payment_method, payment.external_reference, payment.status AS payment_status
       FROM tenant.accounting_vendor_payment_allocations allocation JOIN tenant.accounting_vendor_payments payment ON payment.organization_id = allocation.organization_id AND payment.id = allocation.payment_id
       LEFT JOIN tenant.accounting_vendor_payment_allocation_reversals reversal ON reversal.organization_id = allocation.organization_id AND reversal.allocation_id = allocation.id
      WHERE allocation.organization_id = $1 AND allocation.vendor_bill_id = $2 ORDER BY allocation.allocated_at`, [organizationId, bill.id])).rows;
  const credits = (await client.query(
    `SELECT credit.allocated_amount, credit.allocated_at, note.id, note.bill_number FROM tenant.accounting_vendor_credit_allocations credit
       JOIN tenant.accounting_vendor_bills note ON note.organization_id = credit.organization_id AND note.id = credit.credit_note_id
      WHERE credit.organization_id = $1 AND credit.vendor_bill_id = $2 ORDER BY credit.allocated_at`, [organizationId, bill.id])).rows;
  // The vendor credits that corrected this bill: against it alone, or one of several bills they correct.
  const vendorCredits = bill.bill_type === "bill" ? (await client.query(
    `SELECT id, bill_number, status, bill_date, grand_total, outstanding_amount, debit_note_reason FROM tenant.accounting_vendor_bills credit
      WHERE credit.organization_id = $1 AND credit.bill_type = 'credit_note' AND (credit.source_bill_id = $2 OR EXISTS (SELECT 1 FROM tenant.accounting_vendor_bill_lines line
        JOIN tenant.accounting_vendor_bill_lines source ON source.organization_id = line.organization_id AND source.id = line.source_bill_line_id
        WHERE line.organization_id = credit.organization_id AND line.vendor_bill_id = credit.id AND source.vendor_bill_id = $2)) ORDER BY created_at`, [organizationId, bill.id])).rows : [];
  const returns = bill.source_purchase_order_id ? (await client.query(
    `SELECT id, return_number, return_date, reason FROM tenant.purchase_returns WHERE organization_id = $1 AND purchase_order_id = $2 ORDER BY created_at`, [organizationId, bill.source_purchase_order_id])).rows : [];
  const advances = (await client.query(
    `SELECT id, payment_number, payment_date, unapplied_amount FROM tenant.accounting_vendor_payments WHERE organization_id = $1 AND party_id = $2 AND status IN ('posted', 'partially_applied')
        AND unapplied_amount > 0 AND btrim(currency_code) = $3 ORDER BY payment_date`, [organizationId, bill.party_id, bill.currency_code.trim()])).rows;
  const supplierCredits = (await client.query(
    `SELECT id, bill_number, outstanding_amount FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND party_id = $2 AND bill_type = 'credit_note'
        AND status IN ('posted', 'partially_paid') AND outstanding_amount > 0 AND btrim(currency_code) = $3 ORDER BY bill_date`, [organizationId, bill.party_id, bill.currency_code.trim()])).rows;
  const corrected = bill.bill_type === "bill" ? await creditedOnBillLines(client, organizationId,
    (await client.query(`SELECT id FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND vendor_bill_id = $2`, [organizationId, bill.id])).rows.map((line) => line.id)) : new Map();
  const balance = await calculateSupplierBillBalance(client, context, bill.id);
  const status = documentStatus(row);
  const draft = row.status === "draft";
  const posted = status === "posted";
  const can = (permission) => poCan(context, permission);
  const duplicates = draft ? await checkDuplicateSupplierInvoice(client, context, { partyId: row.party_id, reference: row.supplier_invoice_reference,
    gstin: row.supplier_tax_snapshot?.gstin ?? row.supplier_snapshot?.gstin, billDate: row.bill_date, excludeBillId: row.id }) : [];
  return {
    bill: {
      id: row.id, billNumber: row.bill_number, type: row.bill_type === "credit_note" ? "vendor_credit" : "bill", status: row.status, ...states(row, day),
      supplierInvoiceNumber: row.supplier_invoice_reference ?? row.supplier_invoice_number, supplierInvoiceDate: dayOf(row.bill_date), postingDate: dayOf(row.accounting_date),
      dueDate: dayOf(row.due_date), supplierId: row.supplier_id, supplierName: row.supplier_name, supplier: row.supplier_snapshot, supplierTaxRegistration: row.supplier_tax_snapshot,
      supplierAddress: row.supplier_address_snapshot, buyingRegistration: row.buying_registration_snapshot, placeOfSupply: row.place_of_supply, supplyNature: row.supply_nature,
      reverseCharge: row.reverse_charge, sourceType: row.source_type ?? (row.source_purchase_order_id ? "purchase_order" : "direct"),
      sourceLabel: SOURCE_TYPES.find((entry) => entry.code === (row.source_type ?? (row.source_purchase_order_id ? "purchase_order" : "direct")))?.label,
      purchaseOrderId: row.source_purchase_order_id, purchaseOrderNumber: row.purchase_order_number, currencyCode: row.currency_code.trim(), baseCurrencyCode: row.functional_currency_code.trim(),
      exchangeRate: dec(row.exchange_rate), paymentTerm: readTermSnapshot(row.payment_term_snapshot) ?? row.payment_term_snapshot, priceMode: row.price_mode, notes: row.notes,
      invoiceReceivedDate: dayOf(row.invoice_received_date), acceptanceDate: dayOf(row.acceptance_date), supplierStatedTerms: row.supplier_stated_terms, supplierStatedTermId: row.supplier_stated_term_id,
      paymentTermChangeReason: row.payment_term_change_reason,
      subtotal: dec(row.subtotal), discountTotal: dec(row.discount_total), taxableTotal: dec(row.taxable_total), taxTotal: dec(row.tax_total), reverseChargeTaxTotal: dec(row.reverse_charge_tax_total),
      invoiceTotal: dec(row.invoice_total), withholdingTotal: dec(row.withholding_total), roundingAdjustment: dec(row.rounding_adjustment), netPayable: dec(row.grand_total),
      baseCurrencyTotal: dec(row.base_currency_total), supplierStatedTotal: dec(row.supplier_stated_total), paid: balance.paid, credited: balance.credited, balanceDue: dec(row.outstanding_amount),
      withholdingSection: row.withholding_section_id ? { id: row.withholding_section_id, code: row.section_code, name: row.section_name } : null,
      matchingStatus: row.matching_status, matchOverrideReason: row.match_override_reason, duplicateOverrideReason: row.duplicate_override_reason,
      duplicateOverrideByName: row.duplicate_override_by_name, sourceBillId: row.source_bill_id, sourceBillNumber: row.source_bill_number, debitNoteReason: row.debit_note_reason,
      sourcePurchaseReturnId: row.source_purchase_return_id, purchaseReturnNumber: row.return_number, createdAt: row.created_at, createdByName: row.created_by_name, updatedAt: row.updated_at,
      postedAt: row.posted_at, postedByName: row.posted_by_name, cancelledAt: row.cancelled_at, cancelReason: row.cancel_reason, reversedAt: row.reversed_at, reversedByName: row.reversed_by_name,
      reversalReason: row.reversal_reason, computedDueDate: dayOf(row.computed_due_date), dueDateOverrideReason: row.due_date_override_reason,
      supplierAddressId: row.supplier_address_snapshot?.addressId ?? null, supplierTaxRegistrationId: row.supplier_tax_registration_id, buyingRegistrationId: row.buying_registration_id,
      paymentTermId: row.payment_term_id, matchingBasis: row.matching_basis, sourceGoodsReceiptIds: row.source_goods_receipt_ids ?? [],
    },
    lines: lines.map((line) => {
      const orderPrice = line.order_unit_price === null ? null : decimal(line.order_unit_price);
      const fixed = corrected.get(line.id) ?? { quantity: 0n, taxable: 0n };
      return {
        id: line.id, lineNumber: line.sequence, productId: line.item_id, product: line.product_snapshot, productType: line.product_type, description: line.description,
        hsnSacCode: line.hsn_sac_code, quantity: dec(line.quantity), uom: line.uom_snapshot, unitPrice: dec(line.unit_price), gross: dec(line.gross_amount),
        lineDiscountType: line.line_discount_type, lineDiscountValue: dec(line.line_discount_value), lineDiscount: dec(line.line_discount_amount),
        allocatedDocumentDiscount: dec(line.allocated_document_discount), taxableAmount: dec(line.net_amount), taxAmount: dec(line.tax_amount), reverseCharge: line.reverse_charge,
        reverseChargeTax: dec(line.reverse_charge_tax), withholding: dec(line.withholding_amount), lineTotal: dec(add(line.net_amount, line.tax_amount)),
        account: `${line.account_code} · ${line.account_name}`, varianceAccount: line.variance_code, variance: dec(line.variance_amount),
        taxes: taxes.filter((tax) => tax.vendor_bill_line_id === line.id).map((tax) => ({ type: tax.tax_type, label: tax.label, rate: dec(tax.tax_rate), taxableBase: dec(tax.taxable_base),
          taxAmount: dec(tax.tax_amount), classification: tax.tax_classification })),
        purchaseOrderLineId: line.purchase_order_line_id, orderLineNumber: line.order_line_number, orderedQuantity: dec(line.ordered_quantity),
        orderedUnitPrice: orderPrice === null ? null : dec(orderPrice), priceDifference: orderPrice === null ? null : dec(sub(line.unit_price, orderPrice)),
        receipts: allocations.filter((entry) => entry.vendor_bill_line_id === line.id).map((entry) => ({ goodsReceiptId: entry.goods_receipt_id, receiptNumber: entry.receipt_number,
          receiptLineNumber: entry.line_number, quantity: dec(entry.quantity) })),
        correctedQuantity: dec(fixed.quantity), correctedValue: dec(fixed.taxable), sourceBillLineId: line.source_bill_line_id, adjustmentKind: line.adjustment_kind,
        expenseCategoryId: line.expense_category_id, expenseCategory: line.category_name, costCenterId: line.cost_center_id, costCenter: line.cost_center_name,
        departmentId: line.department_id, department: line.department_name, inputTaxEligibility: line.input_tax_eligibility, taxCategoryId: line.tax_category_id, uomId: line.uom_id,
        billingBasis: line.billing_basis, billedAmount: line.billed_amount === null ? null : dec(line.billed_amount),
      };
    }),
    payments: payments.map((entry) => ({ id: entry.id, paymentId: entry.payment_id, paymentNumber: entry.payment_number, date: dayOf(entry.payment_date), method: entry.payment_method,
      reference: entry.external_reference, amount: dec(entry.allocated_amount), reversed: Boolean(entry.reversed_at), paymentStatus: entry.payment_status })),
    credits: credits.map((entry) => ({ creditId: entry.id, number: entry.bill_number, amount: dec(entry.allocated_amount), at: entry.allocated_at, href: `/procurement/debit-notes-credits/vendor-credits/${entry.id}` })),
    vendorCredits: vendorCredits.map((entry) => ({ id: entry.id, number: entry.bill_number, status: entry.status, date: dayOf(entry.bill_date), total: dec(entry.grand_total),
      unapplied: dec(entry.outstanding_amount), reason: entry.debit_note_reason, href: `/procurement/debit-notes-credits/vendor-credits/${entry.id}` })),
    related: {
      purchaseOrder: row.source_purchase_order_id ? { id: row.source_purchase_order_id, number: row.purchase_order_number, status: row.order_status } : null,
      receipts: [...new Map(allocations.map((entry) => [entry.goods_receipt_id, { id: entry.goods_receipt_id, number: entry.receipt_number }])).values()],
      returns: returns.map((entry) => ({ id: entry.id, number: entry.return_number, date: dayOf(entry.return_date), reason: entry.reason })),
    },
    accounting: { journal: await journalOf(client, organizationId, row.journal_entry_id), reverseCharge: await journalOf(client, organizationId, row.reverse_charge_journal_entry_id),
      reversal: await journalOf(client, organizationId, row.reversal_journal_entry_id) },
    settlementOptions: { advances: advances.map((entry) => ({ id: entry.id, number: entry.payment_number, date: dayOf(entry.payment_date), available: dec(entry.unapplied_amount) })),
      credits: supplierCredits.map((entry) => ({ id: entry.id, number: entry.bill_number, available: dec(entry.outstanding_amount) })) },
    reconciliation: posted ? await reconcileSupplierBill(client, context, row.id) : null,
    duplicates,
    history: await getSupplierBillHistory(client, context, row.id),
    paymentSchedule: row.bill_type === "bill" ? await getSupplierBillPaymentSchedule(client, context, row.id) : null,
    actions: {
      edit: draft && row.bill_type === "bill" && (can(BILL_PERMISSIONS.create) || can(BILL_PERMISSIONS.manage)), post: (draft || row.status === "approved") && row.bill_type === "bill" && can(BILL_PERMISSIONS.manage),
      approve: row.status === "pending_approval" && can(BILL_PERMISSIONS.approve), cancel: ["draft", "pending_approval", "approved"].includes(row.status) && (can(BILL_PERMISSIONS.create) || can(BILL_PERMISSIONS.manage)),
      reverse: ["posted", "overdue"].includes(row.status) && decimal(row.outstanding_amount) === decimal(row.grand_total) && !vendorCredits.some((entry) => !["cancelled", "reversed"].includes(entry.status))
        && can(BILL_PERMISSIONS.reverse),
      createCredit: posted && row.bill_type === "bill" && (can("procurement.credits.manage") || can(BILL_PERMISSIONS.manage)),
      raiseClaim: posted && row.bill_type === "bill" && can("procurement.claims.manage"), recordPayment: posted && row.bill_type === "bill" && decimal(row.outstanding_amount) > 0n && can(BILL_PERMISSIONS.payments),
      applyAdvance: posted && row.bill_type === "bill" && decimal(row.outstanding_amount) > 0n && advances.length > 0 && can(BILL_PERMISSIONS.payments),
      applyCredit: posted && row.bill_type === "bill" && decimal(row.outstanding_amount) > 0n && supplierCredits.length > 0 && can(BILL_PERMISSIONS.payments),
      reversePayment: can("accounting.payments.approve"), overrideDuplicate: can(BILL_PERMISSIONS.overrideDuplicate), overrideMatch: can(BILL_PERMISSIONS.overrideMatch), attach: can(BILL_PERMISSIONS.manage) || can(BILL_PERMISSIONS.create), voucher: true,
    },
  };
}

// The bill form's choices: suppliers, expense and asset accounts, tax categories, TDS sections, payment terms, currencies, company registrations, bank accounts.
export async function getSupplierBillOptions(client, context) {
  requireBillAccess(context);
  const q = async (sql) => (await client.query(sql, [context.organizationId])).rows;
  return {
    views: BILL_VIEWS, sourceTypes: SOURCE_TYPES,
    suppliers: await q(`SELECT supplier.id, supplier.supplier_number, party.display_name AS name, supplier.status, btrim(supplier.default_currency) AS currency_code, supplier.payment_term_id,
                               supplier.withholding_section_id FROM tenant.procurement_suppliers supplier JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id
                               AND party.id = supplier.party_id WHERE supplier.organization_id = $1 ORDER BY party.display_name`),
    accounts: await q(`SELECT id, code, name, account_class FROM tenant.accounting_accounts WHERE organization_id = $1 AND status = 'active' AND NOT is_group AND account_class IN ('expense', 'asset')
                         ORDER BY code`),
    taxCategories: await q(`SELECT id, code, name, reverse_charge FROM tenant.tax_categories WHERE organization_id = $1 AND status = 'active' ORDER BY name`),
    withholdingSections: await q(`SELECT id, code, name, rate FROM tenant.withholding_tax_sections WHERE organization_id = $1 AND status = 'active' ORDER BY code`),
    paymentTerms: await q(`SELECT term.id, term.code, term.name, term.term_type, term.buying_registration_id, (settings.default_payment_term_id = term.id) AS is_default,
                              EXISTS (SELECT 1 FROM tenant.payment_term_lines line WHERE line.organization_id = term.organization_id AND line.payment_term_id = term.id
                                AND line.reference_basis = 'invoice_received') AS needs_invoice_received_date
                            FROM tenant.payment_terms term LEFT JOIN tenant.procurement_settings settings ON settings.organization_id = term.organization_id
                           WHERE term.organization_id = $1 AND term.status = 'active' AND term.is_purchase_enabled ORDER BY term.name`),
    currencies: await q(`SELECT btrim(code) AS code, name FROM tenant.currencies WHERE organization_id = $1 ORDER BY code`),
    registrations: await q(`SELECT id, code, name, registration_number AS gstin, state_code, is_default FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' ORDER BY is_default DESC, name`),
    bankAccounts: await q(`SELECT id, concat_ws(' · ', bank_name, account_name) AS name FROM tenant.accounting_bank_accounts WHERE organization_id = $1 AND status = 'active' ORDER BY bank_name, account_name`),
    expenseCategories: await q(`SELECT id, code, name, account_id, default_tax_category_id, default_hsn_sac FROM tenant.expense_categories WHERE organization_id = $1 AND status = 'active' ORDER BY name`),
    costCenters: await q(`SELECT id, code, name FROM public.cost_centers WHERE organization_id = $1 AND status = 'active' ORDER BY name`),
    departments: await q(`SELECT id, code, name FROM public.departments WHERE organization_id = $1 AND status = 'active' ORDER BY name`),
    uoms: await q(`SELECT id, code, name FROM tenant.units_of_measure WHERE organization_id = $1 AND status = 'active' ORDER BY code`),
    capabilities: { manage: poCan(context, BILL_PERMISSIONS.manage), create: poCan(context, BILL_PERMISSIONS.create) || poCan(context, BILL_PERMISSIONS.manage),
      overrideDueDate: poCan(context, BILL_PERMISSIONS.overrideDueDate), categories: poCan(context, BILL_PERMISSIONS.categories), payments: poCan(context, BILL_PERMISSIONS.payments), reverse: poCan(context, BILL_PERMISSIONS.reverse),
      overrideDuplicate: poCan(context, BILL_PERMISSIONS.overrideDuplicate), overrideMatch: poCan(context, BILL_PERMISSIONS.overrideMatch) },
  };
}
