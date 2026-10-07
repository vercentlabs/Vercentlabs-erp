// Supplier Bills: shared names, permissions and the derived states of a bill. A supplier bill is Finance's Accounts Payable document
// (accounting_vendor_bills, bill_type 'bill'); its lifecycle, payment, due and matching states are read from it, never set by hand.
import { decimal } from "../../../core/decimal.js";
import { PurchaseOrderError, dayOf, fail, has, isUuid, optionalUuid, readDate, requireUuid, text } from "../purchase-orders/constants.js";

export { PurchaseOrderError as SupplierBillError, dayOf, fail, has, isUuid, optionalUuid, readDate, requireUuid, text };

export const BILL_PERMISSIONS = Object.freeze({
  view: "procurement.bills.view",
  manage: "accounting.payables.manage",
  approve: "accounting.payables.approve",
  reverse: "procurement.bills.reverse",
  overrideDuplicate: "procurement.bills.override_duplicate",
  overrideMatch: "procurement.matching.override",
  create: "procurement.bills.create",
  overrideDueDate: "procurement.bills.override_due_date",
  overridePaymentTerms: "procurement.bills.override_payment_terms",
  categories: "procurement.bills.categories",
  payments: "accounting.payments.manage",
  financeView: "accounting.view",
  payablesView: "procurement.suppliers.payables.view",
  poView: "procurement.po.view",
  poViewAll: "procurement.po.view_all",
});

export const SOURCE_TYPES = Object.freeze([
  { code: "purchase_order", label: "Purchase order" }, { code: "goods_receipt", label: "Goods receipt" }, { code: "direct", label: "Direct bill (without PO)" },
]);
export const BILL_VIEWS = Object.freeze([
  { key: "all", label: "All Bills" }, { key: "draft", label: "Draft" }, { key: "posted", label: "Posted" }, { key: "reversed_cancelled", label: "Cancelled / Reversed" },
  { key: "direct", label: "Direct Bills" }, { key: "po_based", label: "PO-Based Bills" }, { key: "partially_billed_pos", label: "Partially Billed POs" },
  { key: "matching_issues", label: "Matching Issues" }, { key: "unpaid", label: "Unpaid" }, { key: "partially_paid", label: "Partially Paid" }, { key: "paid", label: "Paid" },
  { key: "overdue", label: "Overdue" },
]);

const POSTED = ["posted", "partially_paid", "paid", "overdue", "disputed"];
export const POSTED_STATUSES = POSTED;
// Draft (including awaiting Finance's approval) / Posted / Cancelled / Reversed.
export function documentStatus(row) {
  if (row.status === "pending_approval" || row.status === "approved") return "awaiting_approval";
  if (POSTED.includes(row.status)) return "posted";
  return row.status;
}
// Unpaid / Partially paid / Paid, from what Finance settled (payments and credits): the outstanding amount Finance keeps.
export function paymentStatus(row) {
  if (!POSTED.includes(row.status)) return "not_applicable";
  const outstanding = decimal(row.outstanding_amount);
  if (outstanding <= 0n) return "paid";
  return outstanding < decimal(row.grand_total) ? "partially_paid" : "unpaid";
}
// Not due / Due today / Overdue, for what is still owed.
export function dueStatus(row, today) {
  if (!POSTED.includes(row.status) || decimal(row.outstanding_amount) <= 0n) return "settled";
  // The earliest instalment still owed (one overdue instalment makes the bill overdue), else the bill's summary due date.
  const due = dayOf(row.next_due_date ?? row.due_date);
  if (!due) return "not_due";
  return due < today ? "overdue" : due === today ? "due_today" : "not_due";
}
// Matched / Mismatch / Pending receipt / Not applicable.
export function matchingResult(row) {
  if (row.matching_status === "not_required") return "not_applicable";
  if (row.matching_status === "exception") return "mismatch";
  if (row.matching_status === "overridden") return "accepted_variance";
  if (row.matching_status === "pending") return "pending_receipt";
  return "matched";
}

export const BILL_SQL_STATES = Object.freeze({
  posted: `bill.status IN ('posted','partially_paid','paid','overdue','disputed')`,
});
