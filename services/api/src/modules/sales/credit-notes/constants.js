// The vocabulary of credit notes.
//
// A credit note reduces what a customer owes on a posted sales invoice. It is
// its own financial document (Finance's customer credit note), never an edit
// of the invoice: Draft (prepared; changes nothing) → Posted (the customer
// owes less, the books and the output tax are adjusted; fixed) → Reversed
// (posted in error). A draft can be Cancelled. A line credits either a
// quantity (goods returned, damaged or short supplied: at the invoice line's
// own price, discounts and tax, in proportion) or an amount (a price
// adjustment or post-sale discount: a taxable value, taxed at the invoice
// line's own rates). Posting applies the credit to the source invoice; what
// the invoice no longer owes is left as the customer's credit. A refund
// (money back) is separate.
import { OrderError } from "../orders/constants.js";

export const CREDIT_NOTE_STATUS = Object.freeze({ draft: "draft", posted: "posted", reversed: "reversed", cancelled: "cancelled" });
export const CREDIT_NOTE_STATUS_LABELS = Object.freeze({
  draft: "Draft", awaiting_approval: "Awaiting Finance approval", posted: "Posted", reversed: "Reversed", cancelled: "Cancelled",
});
// Finance's statuses and what Sales shows for each.
export const FINANCE_DRAFT = Object.freeze(["draft", "pending_approval", "approved"]);
export const FINANCE_POSTED = Object.freeze(["posted", "partially_paid", "paid", "overdue", "disputed"]);
export function creditNoteStatusOf(financeStatus) {
  if (FINANCE_DRAFT.includes(financeStatus)) return CREDIT_NOTE_STATUS.draft;
  if (FINANCE_POSTED.includes(financeStatus)) return CREDIT_NOTE_STATUS.posted;
  return financeStatus === "reversed" ? CREDIT_NOTE_STATUS.reversed : CREDIT_NOTE_STATUS.cancelled;
}
export const creditNoteStatusLabel = (financeStatus) =>
  financeStatus === "pending_approval" ? CREDIT_NOTE_STATUS_LABELS.awaiting_approval : CREDIT_NOTE_STATUS_LABELS[creditNoteStatusOf(financeStatus)];

// Where a posted credit note's credit went: applied to invoices, refunded by Finance, or still the customer's credit.
// The credit note's own amount never changes.
export const APPLICATION_LABELS = Object.freeze({
  not_applicable: "—", unapplied: "Unapplied", partially_applied: "Partially settled", applied: "Fully applied", refunded: "Refunded", settled: "Applied and refunded",
});
export function applicationStatusOf({ status, total, unapplied, refunded = 0 }) {
  if (creditNoteStatusOf(status) !== CREDIT_NOTE_STATUS.posted) return "not_applicable";
  if (unapplied <= 0.005) return refunded <= 0.005 ? "applied" : refunded + 0.005 >= total ? "refunded" : "settled";
  return unapplied + 0.005 >= total ? "unapplied" : "partially_applied";
}

// Why the customer is credited. "Other" needs an explanation; "Sales return" comes from a received return.
export const CREDIT_REASONS = Object.freeze([
  { code: "sales_return", label: "Sales return" },
  { code: "damaged_goods", label: "Damaged / defective goods" },
  { code: "billing_error", label: "Billing error" },
  { code: "price_adjustment", label: "Price adjustment" },
  { code: "post_sale_discount", label: "Post-sale discount" },
  { code: "short_supply", label: "Short supply" },
  { code: "tax_correction", label: "Tax correction" },
  { code: "order_cancellation", label: "Order cancellation" },
  { code: "service_adjustment", label: "Service adjustment" },
  { code: "other", label: "Other" },
]);
export const reasonLabel = (code) => CREDIT_REASONS.find((entry) => entry.code === code)?.label ?? code;

export const CREDIT_TYPES = Object.freeze({ quantity: "quantity", amount: "amount" });

export const CREDIT_NOTE_PERMISSIONS = Object.freeze({
  view: "sales.credit_note.view",
  viewAll: "sales.credit_note.view_all",
  create: "sales.credit_note.create",
  amount: "sales.credit_note.amount",
  edit: "sales.credit_note.edit",
  post: "sales.credit_note.post",
  reverse: "sales.credit_note.reverse",
  send: "sales.credit_note.send",
  print: "sales.credit_note.print",
  applicationView: "sales.credit_note.application.view",
  accountingView: "sales.credit_note.accounting.view",
});

export const CREDIT_NOTE_VIEWS = Object.freeze([
  { key: "all", label: "All Credit Notes" },
  { key: "draft", label: "Draft" },
  { key: "posted", label: "Posted" },
  { key: "reversed", label: "Reversed / Cancelled" },
  { key: "from_returns", label: "From Returns" },
  { key: "price_adjustments", label: "Price Adjustments" },
  { key: "unapplied", label: "Unapplied Credit" },
]);

export const SENT_CHANNELS = Object.freeze([
  { code: "email", label: "Email (outside Vercentlabs)" }, { code: "courier", label: "Courier / by hand" }, { code: "portal", label: "Customer portal" }, { code: "other", label: "Other" },
]);

export class CreditNoteError extends OrderError {
  constructor(status, message, code = "SALES_CREDIT_NOTE_ERROR", details = undefined) {
    super(status, message, code, details);
    this.name = "CreditNoteError";
  }
}
