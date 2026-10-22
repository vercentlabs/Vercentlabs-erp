// Supplier Payments (Procurement plan Phase 1): the payments made to suppliers, read from Finance's records (accounting_vendor_payments —
// Procurement never writes them except through Finance's own functions), with the bills each settled and the TDS withheld on those
// bills; paying several bills at once from Payables (one payment per supplier, through Finance's approval policy); the advances a
// supplier still holds, for the bill form; and the MSME payments view over the statutory deadlines (MSMED Act s.15).
import { add, decimal, formatDecimal } from "../../../core/decimal.js";
import { appOn } from "../../../core/access/apps.js";
import { companyToday } from "../../../core/payment-terms/index.js";
import { addDays } from "../../../core/payment-terms/terms.js";
import { AccountingError, allocateVendorPayment, createVendorPayment, postVendorPayment, submitSubledgerDocument } from "../../accounting/index.js";
import { postApprovedPayment } from "../../accounting/payables-ap/index.js";
import { poCan, requirePoPermission } from "../purchase-orders/access.js";
import { fin, requireBillAccess } from "../supplier-bills/bills.js";
import { BILL_PERMISSIONS, SupplierBillError, dayOf, fail, isUuid, optionalUuid, readDate, requireUuid, text } from "../supplier-bills/constants.js";
import { pagingOf } from "../paging.js";

const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
export const SUPPLIER_PAYMENT_METHODS = Object.freeze({ bank_transfer: "Bank transfer (NEFT/RTGS/IMPS)", upi: "UPI", cheque: "Cheque", cash: "Cash", card: "Card", gateway: "Payment gateway", other: "Other" });
export const SUPPLIER_PAYMENT_STATUS_LABELS = Object.freeze({
  draft: "Draft", pending_approval: "Awaiting approval", approved: "Approved", posted: "Paid", partially_applied: "Paid (part advance)", applied: "Paid", reversed: "Reversed", cancelled: "Cancelled",
});
export const SUPPLIER_PAYMENT_VIEWS = Object.freeze([
  { key: "all", label: "All" }, { key: "this_month", label: "This month" }, { key: "advances", label: "Advances" }, { key: "awaiting_approval", label: "Awaiting approval" },
  { key: "reversed", label: "Reversed" },
]);
const PAID = "('posted', 'partially_applied', 'applied')";
const NOT_REVERSED = `NOT EXISTS (SELECT 1 FROM tenant.accounting_vendor_payment_allocation_reversals reversal WHERE reversal.organization_id = allocation.organization_id AND reversal.allocation_id = allocation.id)`;

async function finance(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AccountingError) throw new SupplierBillError(error.status ?? 409, error.message, error.code === "ACCOUNTING_ERROR" ? "SUPPLIER_PAYMENT_FINANCE" : error.code);
    throw error;
  }
}

// Payments to suppliers (a party with a supplier record). filters: view, supplierId, method, dateFrom, dateTo, search (payment no.,
// supplier, reference / UTR, bill no., supplier invoice no.), limit, offset.
export async function listSupplierPayments(client, context, filters = {}) {
  requireBillAccess(context);
  const values = [context.organizationId];
  const bind = (value) => `$${values.push(value)}`;
  let where = "";
  const today = await companyToday(client, context.organizationId);
  const view = SUPPLIER_PAYMENT_VIEWS.some((entry) => entry.key === filters.view) ? filters.view : "all";
  if (view === "this_month") where += ` AND payment.payment_date >= date_trunc('month', ${bind(today)}::date) AND payment.status NOT IN ('cancelled')`;
  else if (view === "advances") where += ` AND payment.status IN ${PAID} AND payment.unapplied_amount > 0`;
  else if (view === "awaiting_approval") where += " AND payment.status IN ('draft', 'pending_approval', 'approved')";
  else if (view === "reversed") where += " AND payment.status IN ('reversed', 'cancelled')";
  if (isUuid(filters.supplierId)) where += ` AND supplier.id = ${bind(filters.supplierId)}`;
  if (Object.hasOwn(SUPPLIER_PAYMENT_METHODS, filters.method ?? "")) where += ` AND payment.payment_method = ${bind(filters.method)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateFrom ?? ""))) where += ` AND payment.payment_date >= ${bind(filters.dateFrom)}::date`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(filters.dateTo ?? ""))) where += ` AND payment.payment_date <= ${bind(filters.dateTo)}::date`;
  const search = text(filters.search, 120);
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (payment.payment_number ILIKE ${term} OR party.display_name ILIKE ${term} OR supplier.supplier_number ILIKE ${term} OR payment.external_reference ILIKE ${term}
      OR EXISTS (SELECT 1 FROM tenant.accounting_vendor_payment_allocations allocation JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = allocation.organization_id
                   AND bill.id = allocation.vendor_bill_id WHERE allocation.organization_id = payment.organization_id AND allocation.payment_id = payment.id
                   AND (bill.bill_number ILIKE ${term} OR COALESCE(bill.supplier_invoice_reference, bill.supplier_invoice_number) ILIKE ${term})))`;
  }
  const sql =
    `SELECT payment.id, payment.payment_number, payment.payment_date, payment.payment_method, payment.external_reference, payment.amount, payment.unapplied_amount, payment.status,
            btrim(payment.currency_code) AS currency_code, supplier.id AS supplier_id, supplier.supplier_number, party.display_name AS supplier_name, po.purchase_order_number,
            payment.purchase_order_id,
            CASE WHEN payment.status IN ('draft', 'pending_approval', 'approved') THEN
              (SELECT COALESCE(json_agg(json_build_object('id', bill.id, 'number', bill.bill_number) ORDER BY bill.bill_date), '[]'::json)
                 FROM jsonb_array_elements(COALESCE(payment.planned_allocations, '[]'::jsonb)) planned
                 JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = payment.organization_id AND bill.id::text = planned->>'billId')
            ELSE
              (SELECT COALESCE(json_agg(json_build_object('id', bill.id, 'number', bill.bill_number) ORDER BY bill.bill_date), '[]'::json)
                 FROM tenant.accounting_vendor_payment_allocations allocation JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = allocation.organization_id AND bill.id = allocation.vendor_bill_id
                WHERE allocation.organization_id = payment.organization_id AND allocation.payment_id = payment.id AND ${NOT_REVERSED}) END AS bills
       FROM tenant.accounting_vendor_payments payment
       JOIN tenant.business_parties party ON party.organization_id = payment.organization_id AND party.id = payment.party_id
       JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = payment.organization_id AND supplier.party_id = payment.party_id
       LEFT JOIN tenant.purchase_orders po ON po.organization_id = payment.organization_id AND po.id = payment.purchase_order_id
      WHERE payment.organization_id = $1${where} ORDER BY payment.payment_date DESC, payment.created_at DESC`;
  const paging = pagingOf({ limit: filters.limit ?? 50, offset: filters.offset ?? 0 });
  const rows = (await client.query(`${sql}${paging.clause}`, values)).rows;
  const total = Number((await client.query(`SELECT count(*)::int AS total FROM (${sql}) counted`, values)).rows[0].total);
  return {
    rows: rows.map((row) => ({
      id: row.id, number: row.payment_number, date: dayOf(row.payment_date), method: row.payment_method, methodLabel: SUPPLIER_PAYMENT_METHODS[row.payment_method] ?? row.payment_method,
      reference: row.external_reference, amount: dec(row.amount), unapplied: dec(row.unapplied_amount), status: row.status, statusLabel: SUPPLIER_PAYMENT_STATUS_LABELS[row.status] ?? row.status,
      currencyCode: row.currency_code, supplierId: row.supplier_id, supplierNumber: row.supplier_number, supplierName: row.supplier_name, bills: row.bills,
      purchaseOrderId: row.purchase_order_id, purchaseOrderNumber: row.purchase_order_number,
    })),
    total, limit: paging.limit, offset: paging.offset, views: SUPPLIER_PAYMENT_VIEWS, methods: Object.entries(SUPPLIER_PAYMENT_METHODS).map(([code, label]) => ({ code, label })),
  };
}

// One payment with the bills it settled, the TDS withheld on each and the supplier's details — the page and the payment advice PDF.
export async function getSupplierPayment(client, context, paymentId) {
  requireBillAccess(context);
  const row = (await client.query(
    `SELECT payment.*, btrim(payment.currency_code) AS currency, supplier.id AS supplier_id, supplier.supplier_number, supplier.msme_classification, supplier.msme_registration_number,
            party.display_name AS supplier_name, party.legal_name, party.gstin, party.pan, po.purchase_order_number, bank.bank_name, bank.account_name AS bank_account_name,
            bank.masked_account_number, creator.full_name AS created_by_name
       FROM tenant.accounting_vendor_payments payment
       JOIN tenant.business_parties party ON party.organization_id = payment.organization_id AND party.id = payment.party_id
       JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = payment.organization_id AND supplier.party_id = payment.party_id
       LEFT JOIN tenant.purchase_orders po ON po.organization_id = payment.organization_id AND po.id = payment.purchase_order_id
       LEFT JOIN tenant.accounting_bank_accounts bank ON bank.organization_id = payment.organization_id AND bank.id = payment.bank_account_id
       LEFT JOIN public.users creator ON creator.id = payment.created_by
      WHERE payment.organization_id = $1 AND payment.id = $2`, [context.organizationId, requireUuid(paymentId, "Payment")])).rows[0];
  if (!row) throw new SupplierBillError(404, "Supplier payment not found.", "SUPPLIER_PAYMENT_NOT_FOUND");
  const allocations = (await client.query(
    `SELECT allocation.id, allocation.allocated_amount, allocation.allocated_at, bill.id AS bill_id, bill.bill_number, bill.bill_date, bill.due_date,
            COALESCE(bill.supplier_invoice_reference, bill.supplier_invoice_number) AS supplier_invoice, bill.grand_total, bill.withholding_total, bill.outstanding_amount,
            COALESCE(bill.taxable_total, bill.subtotal - bill.discount_total) AS taxable, section.code AS section_code, ${NOT_REVERSED} AS active
       FROM tenant.accounting_vendor_payment_allocations allocation
       JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = allocation.organization_id AND bill.id = allocation.vendor_bill_id
       LEFT JOIN tenant.withholding_tax_sections section ON section.organization_id = bill.organization_id AND section.id = bill.withholding_section_id
      WHERE allocation.organization_id = $1 AND allocation.payment_id = $2 ORDER BY bill.bill_date, bill.bill_number`, [context.organizationId, row.id])).rows;
  const planned = row.status === "pending_approval" || row.status === "approved" || row.status === "draft" ? (row.planned_allocations ?? []) : [];
  const plannedBills = planned.length ? (await client.query(
    `SELECT id, bill_number, bill_date, COALESCE(supplier_invoice_reference, supplier_invoice_number) AS supplier_invoice, grand_total, withholding_total FROM tenant.accounting_vendor_bills
      WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [context.organizationId, planned.map((entry) => entry.billId).filter(isUuid)])).rows : [];
  const accountingOn = await appOn(client, context, "accounting");
  const active = allocations.filter((entry) => entry.active);
  const tds = active.reduce((total, entry) => add(total, decimal(entry.withholding_total ?? 0)), 0n);
  return {
    payment: {
      id: row.id, number: row.payment_number, date: dayOf(row.payment_date), method: row.payment_method, methodLabel: SUPPLIER_PAYMENT_METHODS[row.payment_method] ?? row.payment_method,
      reference: row.external_reference, amount: dec(row.amount), unapplied: dec(row.unapplied_amount), status: row.status, statusLabel: SUPPLIER_PAYMENT_STATUS_LABELS[row.status] ?? row.status,
      currencyCode: row.currency, notes: row.notes, bankAccount: row.bank_name ? `${row.bank_name}${row.masked_account_number ? ` · ${row.masked_account_number}` : ""}` : null,
      purchaseOrderId: row.purchase_order_id, purchaseOrderNumber: row.purchase_order_number, reversedAt: row.reversed_at, reversalReason: row.reversal_reason,
      createdBy: row.created_by_name, tdsWithheld: dec(tds),
      // Approved by Finance and not yet posted: it can be posted now, settling the bills it was approved for.
      canPost: row.status === "approved" && poCan(context, BILL_PERMISSIONS.payments),
      accountingHref: accountingOn ? `/accounting/payments/${row.id}` : null,
    },
    supplier: {
      id: row.supplier_id, number: row.supplier_number, name: row.supplier_name, legalName: row.legal_name, gstin: row.gstin, pan: row.pan,
      msme: row.msme_classification ? { classification: row.msme_classification, udyam: row.msme_registration_number } : null,
    },
    allocations: allocations.map((entry) => ({
      id: entry.id, billId: entry.bill_id, billNumber: entry.bill_number, supplierInvoice: entry.supplier_invoice, billDate: dayOf(entry.bill_date), dueDate: dayOf(entry.due_date),
      billTotal: dec(entry.grand_total), taxable: dec(entry.taxable), tds: dec(entry.withholding_total ?? 0), tdsSection: entry.section_code, amount: dec(entry.allocated_amount),
      balance: dec(entry.outstanding_amount), reversed: !entry.active, href: `/procurement/supplier-bills/${entry.bill_id}`,
    })),
    planned: planned.map((entry) => {
      const bill = plannedBills.find((candidate) => candidate.id === entry.billId);
      return { billId: entry.billId, billNumber: bill?.bill_number ?? null, supplierInvoice: bill?.supplier_invoice ?? null, billDate: dayOf(bill?.bill_date), amount: entry.amount,
        tds: dec(bill?.withholding_total ?? 0), href: `/procurement/supplier-bills/${entry.billId}` };
    }),
  };
}

// paySupplierBills: "Pay selected" from Payables. Bills are grouped by supplier and currency; each group is one payment through Finance
// (its approval policy, then posting and allocation), for the whole balance of each bill unless amounts are given.
// input: { bills: [{ billId, amount? }], paymentDate?, paymentMethod?, bankAccountId?, reference? }. Returns { payments: [...] }.
export async function paySupplierBills(client, context, input = {}) {
  requirePoPermission(context, BILL_PERMISSIONS.payments, "You do not have permission to record supplier payments.");
  const requested = Array.isArray(input.bills) ? input.bills : [];
  if (!requested.length) fail("Choose the bills to pay.", "bills", "SUPPLIER_PAYMENT_BILLS_REQUIRED");
  if (requested.length > 200) fail("Pay at most 200 bills at a time.", "bills");
  const ids = [...new Set(requested.map((entry) => requireUuid(entry.billId, "Bill")))];
  const bills = (await client.query(
    `SELECT bill.id, bill.bill_number, bill.party_id, bill.supplier_id, btrim(bill.currency_code) AS currency_code, bill.outstanding_amount, bill.status, bill.bill_type
       FROM tenant.accounting_vendor_bills bill WHERE bill.organization_id = $1 AND bill.id = ANY($2::uuid[]) ORDER BY bill.due_date, bill.bill_date FOR UPDATE`,
    [context.organizationId, ids])).rows;
  if (bills.length !== ids.length) fail("A chosen bill was not found.", "bills", "SUPPLIER_BILL_NOT_FOUND", 404);
  const method = Object.hasOwn(SUPPLIER_PAYMENT_METHODS, input.paymentMethod ?? "") ? input.paymentMethod : "bank_transfer";
  const paymentDate = readDate(input.paymentDate, "Payment date") ?? undefined;
  const bankAccountId = optionalUuid(input.bankAccountId, "Bank account") ?? undefined;
  const reference = text(input.reference, 120) ?? undefined;
  const groups = new Map();
  for (const bill of bills) {
    if (bill.bill_type !== "bill" || !["posted", "partially_paid", "overdue", "disputed"].includes(bill.status) || decimal(bill.outstanding_amount) <= 0n)
      fail(`${bill.bill_number} has nothing to pay (only posted bills with a balance due can be paid).`, "bills", "SUPPLIER_BILL_NOT_PAYABLE", 409);
    const asked = requested.find((entry) => entry.billId === bill.id)?.amount;
    const raw = asked === undefined || asked === null || asked === "" ? dec(bill.outstanding_amount) : String(asked).trim();
    if (!/^\d+(?:\.\d{1,6})?$/.test(raw) || decimal(raw) <= 0n) fail(`${bill.bill_number}: enter the amount to pay.`, "bills", "SUPPLIER_PAYMENT_AMOUNT_INVALID");
    if (decimal(raw) > decimal(bill.outstanding_amount)) fail(`${bill.bill_number}: only ${dec(bill.outstanding_amount)} is due.`, "bills", "SUPPLIER_PAYMENT_EXCEEDS_DUE", 409);
    const key = `${bill.party_id}:${bill.currency_code}`;
    if (!groups.has(key)) groups.set(key, { partyId: bill.party_id, currencyCode: bill.currency_code, allocations: [] });
    groups.get(key).allocations.push({ billId: bill.id, amount: raw, billNumber: bill.bill_number });
  }
  const payments = [];
  for (const group of groups.values()) {
    const amount = dec(group.allocations.reduce((total, entry) => add(total, decimal(entry.amount)), 0n));
    const allocations = group.allocations.map(({ billId, amount: part }) => ({ billId, amount: part }));
    const payment = await finance(() => createVendorPayment(client, fin(context), {
      partyId: group.partyId, paymentDate, currencyCode: group.currencyCode, amount, paymentMethod: method, bankAccountId, externalReference: reference,
    }));
    await client.query("UPDATE tenant.accounting_vendor_payments SET planned_allocations = $3::jsonb WHERE organization_id = $1 AND id = $2",
      [context.organizationId, payment.id, JSON.stringify(allocations)]);
    const submitted = await finance(() => submitSubledgerDocument(client, fin(context), "vendor_payment", payment.id));
    if (submitted.status === "pending_approval") {
      payments.push({ paymentId: payment.id, paymentNumber: payment.payment_number, status: "awaiting_approval", amount, bills: group.allocations.map((entry) => entry.billNumber) });
      continue;
    }
    await finance(() => postVendorPayment(client, fin(context), payment.id));
    await finance(() => allocateVendorPayment(client, fin(context), payment.id, { allocations }));
    payments.push({ paymentId: payment.id, paymentNumber: payment.payment_number, status: "posted", amount, bills: group.allocations.map((entry) => entry.billNumber) });
  }
  return { payments };
}

// completeSupplierPayment: a payment from "Pay selected" that waited for Finance's approval is posted once approved and settles the bills
// it was approved for (each only for what it still owes; the rest stays an advance).
export async function completeSupplierPayment(client, context, paymentId) {
  requirePoPermission(context, BILL_PERMISSIONS.payments, "You do not have permission to record supplier payments.");
  const payment = (await client.query(`SELECT id, status FROM tenant.accounting_vendor_payments WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, requireUuid(paymentId, "Payment")])).rows[0];
  if (!payment) throw new SupplierBillError(404, "Supplier payment not found.", "SUPPLIER_PAYMENT_NOT_FOUND");
  if (payment.status === "pending_approval") throw new SupplierBillError(409, "The payment is still awaiting Finance's approval.", "SUPPLIER_PAYMENT_PENDING");
  if (payment.status !== "approved") return { paymentId: payment.id, status: payment.status, replayed: true };
  const result = await finance(() => postApprovedPayment(client, fin(context), payment.id));
  return { paymentId: payment.id, status: "posted", skipped: result.skipped };
}

// The advances a supplier has paid and not yet used (posted payments with an unapplied amount) — shown when a bill is entered, so it
// can be adjusted once the bill posts. filters: { supplierId, purchaseOrderId? } (an advance against that order first).
export async function getSupplierAdvances(client, context, filters = {}) {
  requireBillAccess(context);
  const supplierId = requireUuid(filters.supplierId, "Supplier");
  const orderId = isUuid(filters.purchaseOrderId) ? filters.purchaseOrderId : null;
  const rows = (await client.query(
    `SELECT payment.id, payment.payment_number, payment.payment_date, payment.unapplied_amount, btrim(payment.currency_code) AS currency_code, payment.purchase_order_id, po.purchase_order_number
       FROM tenant.accounting_vendor_payments payment
       JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = payment.organization_id AND supplier.party_id = payment.party_id
       LEFT JOIN tenant.purchase_orders po ON po.organization_id = payment.organization_id AND po.id = payment.purchase_order_id
      WHERE payment.organization_id = $1 AND supplier.id = $2 AND payment.status IN ${PAID} AND payment.unapplied_amount > 0
      ORDER BY (payment.purchase_order_id IS NOT DISTINCT FROM $3::uuid) DESC, payment.payment_date`, [context.organizationId, supplierId, orderId])).rows;
  const total = rows.reduce((sum, row) => add(sum, decimal(row.unapplied_amount)), 0n);
  return {
    total: dec(total),
    advances: rows.map((row) => ({ id: row.id, number: row.payment_number, date: dayOf(row.payment_date), available: dec(row.unapplied_amount), currencyCode: row.currency_code,
      purchaseOrderId: row.purchase_order_id, purchaseOrderNumber: row.purchase_order_number, againstThisOrder: Boolean(orderId) && row.purchase_order_id === orderId })),
  };
}

// MSME Payments (MSMED Act s.15 and s.43B(h)): every open statutory deadline with what its bill still owes, oldest obligation settled
// first (as complianceDeadlinesOf works it out), bucketed by the days left. filters: { bucket?: overdue | due_7 | due_15 | due_45 | disputed, supplierId?, search? }
export const MSME_PAYMENT_BUCKETS = Object.freeze([
  { key: "all", label: "All open" }, { key: "overdue", label: "Overdue" }, { key: "due_7", label: "Due in 7 days" }, { key: "due_15", label: "Due in 15 days" },
  { key: "due_45", label: "Due in 45 days" }, { key: "disputed", label: "Disputed" },
]);
export async function listMsmePayments(client, context, filters = {}) {
  requireBillAccess(context);
  if (!poCan(context, "procurement.compliance.view") && !poCan(context, "accounting.payables.manage") && !poCan(context, BILL_PERMISSIONS.view))
    throw new SupplierBillError(403, "You do not have permission to view supplier payment compliance.", "PERMISSION_DENIED");
  const today = await companyToday(client, context.organizationId);
  const values = [context.organizationId];
  let where = "";
  if (isUuid(filters.supplierId)) { values.push(filters.supplierId); where += ` AND bill.supplier_id = $${values.length}`; }
  const search = text(filters.search, 120);
  if (search) { values.push(`%${search}%`); where += ` AND (bill.bill_number ILIKE $${values.length} OR party.display_name ILIKE $${values.length} OR COALESCE(bill.supplier_invoice_reference, bill.supplier_invoice_number) ILIKE $${values.length})`; }
  const rows = (await client.query(
    `SELECT deadline.*, bill.bill_number, bill.grand_total, bill.outstanding_amount, btrim(bill.currency_code) AS currency_code, bill.supplier_id,
            COALESCE(bill.supplier_invoice_reference, bill.supplier_invoice_number) AS supplier_invoice, party.display_name AS supplier_name, supplier.msme_registration_number
       FROM tenant.supplier_payment_compliance_deadlines deadline
       JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = deadline.organization_id AND bill.id = deadline.vendor_bill_id
       JOIN tenant.business_parties party ON party.organization_id = bill.organization_id AND party.id = bill.party_id
       LEFT JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = bill.organization_id AND supplier.id = bill.supplier_id
      WHERE deadline.organization_id = $1 AND deadline.status = 'open' AND bill.status IN ('posted', 'partially_paid', 'overdue', 'disputed') AND bill.outstanding_amount > 0${where}
      ORDER BY bill.id, deadline.acceptance_date, deadline.created_at`, values)).rows;
  // What each bill still owes is taken against its earliest deadlines first.
  const paidByBill = new Map();
  const entries = [];
  for (const row of rows) {
    if (!paidByBill.has(row.vendor_bill_id)) paidByBill.set(row.vendor_bill_id, decimal(row.grand_total) - decimal(row.outstanding_amount));
    const amount = decimal(row.applicable_amount);
    const paid = paidByBill.get(row.vendor_bill_id);
    const settled = paid >= amount ? amount : paid;
    paidByBill.set(row.vendor_bill_id, paid - settled);
    const outstanding = amount - settled;
    if (outstanding <= 0n) continue;
    const due = dayOf(row.statutory_due_date);
    const daysLeft = Math.round((Date.parse(due) - Date.parse(today)) / 86400000);
    const disputed = row.disputed && !row.dispute_resolved_on;
    const bucket = disputed ? "disputed" : daysLeft < 0 ? "overdue" : daysLeft <= 7 ? "due_7" : daysLeft <= 15 ? "due_15" : "due_45";
    entries.push({
      id: row.id, billId: row.vendor_bill_id, billNumber: row.bill_number, supplierInvoice: row.supplier_invoice, supplierId: row.supplier_id, supplierName: row.supplier_name,
      classification: row.classification_snapshot?.classification ?? null, udyam: row.msme_registration_number ?? row.classification_snapshot?.registrationNumber ?? null,
      sourceReference: row.source_reference, acceptanceDate: dayOf(row.acceptance_date), statutoryDays: row.statutory_days, statutoryDueDate: due, daysLeft, bucket, disputed,
      disputeReference: row.dispute_reference, outstanding: dec(outstanding), currencyCode: row.currency_code, href: `/procurement/supplier-bills/${row.vendor_bill_id}`,
    });
  }
  entries.sort((a, b) => a.statutoryDueDate.localeCompare(b.statutoryDueDate) || a.billNumber.localeCompare(b.billNumber));
  const counts = Object.fromEntries(MSME_PAYMENT_BUCKETS.map((entry) => [entry.key, 0]));
  const totals = Object.fromEntries(MSME_PAYMENT_BUCKETS.map((entry) => [entry.key, 0n]));
  for (const entry of entries) {
    counts.all += 1; totals.all += decimal(entry.outstanding);
    counts[entry.bucket] += 1; totals[entry.bucket] += decimal(entry.outstanding);
    // "Due in 15 days" and "Due in 45 days" include the nearer ones, as a person reading "due within" expects.
    if (entry.bucket === "due_7") { counts.due_15 += 1; totals.due_15 += decimal(entry.outstanding); }
    if (entry.bucket === "due_7" || entry.bucket === "due_15") { counts.due_45 += 1; totals.due_45 += decimal(entry.outstanding); }
  }
  const bucket = MSME_PAYMENT_BUCKETS.some((entry) => entry.key === filters.bucket) ? filters.bucket : "all";
  const inBucket = (entry) => bucket === "all" || entry.bucket === bucket || (bucket === "due_15" && entry.bucket === "due_7")
    || (bucket === "due_45" && (entry.bucket === "due_7" || entry.bucket === "due_15"));
  return {
    today, until45: addDays(today, 45), bucket, buckets: MSME_PAYMENT_BUCKETS.map((entry) => ({ ...entry, count: counts[entry.key], total: dec(totals[entry.key]) })),
    rows: entries.filter(inBucket),
  };
}
