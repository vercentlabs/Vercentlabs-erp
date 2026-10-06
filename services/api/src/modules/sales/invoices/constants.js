// The vocabulary of sales invoices.
//
// A sales invoice is Finance's customer invoice made by Sales from a
// confirmed order or a delivery. Its life is short: Draft (editable, not yet
// owed, not in the books) → Posted (the customer's receivable, entered in
// the books, fixed) → Reversed (posted in error, nothing applied to it). A
// draft can be Cancelled. Payment is a separate status, worked out from the
// receipts and credits Finance applies: Unpaid, Partially paid, Paid, and
// Overdue when the due date has passed with a balance.
import { OrderError } from "../orders/constants.js";

export const INVOICE_STATUS = Object.freeze({ draft: "draft", posted: "posted", reversed: "reversed", cancelled: "cancelled" });
export const INVOICE_STATUS_LABELS = Object.freeze({ draft: "Draft", awaiting_approval: "Awaiting Finance approval", posted: "Posted", reversed: "Reversed", cancelled: "Cancelled" });
// Finance's statuses and what Sales shows for each.
export const FINANCE_DRAFT = Object.freeze(["draft", "pending_approval", "approved"]);
export const FINANCE_POSTED = Object.freeze(["posted", "partially_paid", "paid", "overdue", "disputed"]);
export function invoiceStatusOf(financeStatus) {
  if (FINANCE_DRAFT.includes(financeStatus)) return INVOICE_STATUS.draft;
  if (FINANCE_POSTED.includes(financeStatus)) return INVOICE_STATUS.posted;
  return financeStatus === "reversed" ? INVOICE_STATUS.reversed : INVOICE_STATUS.cancelled;
}
export const invoiceStatusLabel = (financeStatus) =>
  financeStatus === "pending_approval" ? INVOICE_STATUS_LABELS.awaiting_approval : INVOICE_STATUS_LABELS[invoiceStatusOf(financeStatus)];

// How much of the invoice posted credit notes have credited; the invoice's own total never changes.
export const CREDIT_STATUS_LABELS = Object.freeze({ not_credited: "Not credited", partially_credited: "Partially credited", fully_credited: "Fully credited" });
export function creditStatusOf({ total, credited }) {
  if (credited <= 0.005) return "not_credited";
  return credited + 0.005 >= total ? "fully_credited" : "partially_credited";
}

export const PAYMENT_STATUS_LABELS = Object.freeze({ not_applicable: "—", unpaid: "Unpaid", partially_paid: "Partially paid", paid: "Paid" });
// From the amounts Finance applied; Overdue is a condition beside it, never a status of its own.
export function paymentStatusOf({ status, total, paid }) {
  if (invoiceStatusOf(status) !== INVOICE_STATUS.posted) return "not_applicable";
  if (paid <= 0.005) return "unpaid";
  return paid + 0.005 >= total ? "paid" : "partially_paid";
}

// How much can be invoiced: what was ordered, or only what was delivered (goods; services always as ordered).
export const QUANTITY_BASIS = Object.freeze({ ordered: "ordered", delivered: "delivered" });
// The Sales setting keeps its stored values.
export const basisOfSetting = (setting) => (setting === "fulfilled" ? QUANTITY_BASIS.delivered : QUANTITY_BASIS.ordered);

export const INVOICE_PERMISSIONS = Object.freeze({
  view: "sales.invoice.view",
  viewAll: "sales.invoice.view_all",
  create: "sales.invoice.request",
  edit: "sales.invoice.edit",
  post: "sales.invoice.post",
  reverse: "sales.invoice.reverse",
  send: "sales.invoice.send",
  print: "sales.invoice.print",
  creditNote: "sales.credit_note.create",
  paymentsView: "sales.invoice.payments.view",
  accountingView: "sales.invoice.accounting.view",
  changePostingDate: "sales.invoice.change_posting_date",
  changePaymentTerms: "sales.invoice.change_payment_terms",
  overrideDueDate: "sales.invoice.override_due_date",
  changePostedDueDate: "sales.invoice.change_posted_due_date",
  overrideTax: "tax.transaction.override",
  recordPayment: "accounting.receipts.manage",
});

export const INVOICE_VIEWS = Object.freeze([
  { key: "all", label: "All Invoices" },
  { key: "draft", label: "Draft" },
  { key: "posted", label: "Posted" },
  { key: "unpaid", label: "Unpaid" },
  { key: "partially_paid", label: "Partially Paid" },
  { key: "balance_due", label: "Balance Due" },
  { key: "paid", label: "Paid" },
  { key: "due_today", label: "Due Today" },
  { key: "due_this_week", label: "Due This Week" },
  { key: "overdue", label: "Overdue" },
  { key: "reversed", label: "Cancelled / Reversed" },
  { key: "mine", label: "My Invoices" },
]);

export const SENT_CHANNELS = Object.freeze([
  { code: "email", label: "Email (outside Vercentlabs)" }, { code: "courier", label: "Courier / by hand" }, { code: "portal", label: "Customer portal" }, { code: "other", label: "Other" },
]);

export class InvoiceError extends OrderError {
  constructor(status, message, code = "SALES_INVOICE_ERROR", details = undefined) {
    super(status, message, code, details);
    this.name = "InvoiceError";
  }
}
