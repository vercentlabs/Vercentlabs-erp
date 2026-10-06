// The vocabulary of customer refunds.
//
// A refund pays a customer back out of credit the customer really has: what
// is left unapplied on a posted credit note, or on a receipt (an overpayment
// or an advance). It is a payment, owned by Finance: Draft (prepared; no
// effect) → Posted (the credit is consumed and the bank or cash account is
// credited; fixed) → Reversed (posted in error). A draft can be Cancelled.
// A refund never changes an invoice, a credit note's amount, stock or tax:
// the credit note already corrected revenue and tax, and a return already
// moved the goods. Credit can equally be applied to another invoice instead.
import { AccountingError } from "../core.js";

export const REFUND_STATUS = Object.freeze({ draft: "draft", posted: "posted", reversed: "reversed", cancelled: "cancelled" });
export const REFUND_STATUS_LABELS = Object.freeze({ draft: "Draft", posted: "Posted", reversed: "Reversed", cancelled: "Cancelled" });

// Why the money goes back. The reason never replaces the source: the credit note or receipt is always named.
export const REFUND_REASONS = Object.freeze([
  { code: "customer_credit", label: "Customer credit refund" },
  { code: "overpayment", label: "Overpayment refund" },
  { code: "order_cancellation", label: "Order cancellation" },
  { code: "returned_goods", label: "Returned goods" },
  { code: "billing_adjustment", label: "Billing adjustment" },
  { code: "duplicate_payment", label: "Duplicate payment" },
  { code: "other", label: "Other" },
]);
export const refundReasonLabel = (code) => REFUND_REASONS.find((entry) => entry.code === code)?.label ?? code;

export const REFUND_METHODS = Object.freeze([
  { code: "bank_transfer", label: "Bank transfer" },
  { code: "cash", label: "Cash" },
  { code: "cheque", label: "Cheque" },
  { code: "other", label: "Other" },
]);
export const refundMethodLabel = (code) => REFUND_METHODS.find((entry) => entry.code === code)?.label ?? code;

export const REFUND_SOURCE = Object.freeze({ creditNote: "credit_note", receipt: "receipt" });
export const REFUND_SOURCE_LABELS = Object.freeze({ credit_note: "Credit note", receipt: "Receipt (unapplied)" });

export const REFUND_PERMISSIONS = Object.freeze({
  view: "accounting.refund.view",
  create: "accounting.refund.create",
  edit: "accounting.refund.edit",
  cancel: "accounting.refund.cancel",
  selectAccount: "accounting.refund.select_account",
  post: "accounting.refund.post",
  reverse: "accounting.refund.reverse",
  send: "accounting.refund.send",
  accountingView: "accounting.refund.accounting.view",
  creditView: "accounting.customer_credit.view",
});

export const REFUND_VIEWS = Object.freeze([
  { key: "all", label: "All Refunds" },
  { key: "draft", label: "Draft" },
  { key: "posted", label: "Posted" },
  { key: "reversed", label: "Reversed / Cancelled" },
]);

export const REFUND_SENT_CHANNELS = Object.freeze([
  { code: "email", label: "Email (outside Vercentlabs)" }, { code: "courier", label: "Courier / by hand" }, { code: "portal", label: "Customer portal" }, { code: "other", label: "Other" },
]);

export class RefundError extends AccountingError {
  constructor(status, message, code = "ACCOUNTING_REFUND_ERROR", details = undefined) {
    super(status, message, code);
    this.details = details;
  }
}

export const refundCan = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));
export function requireRefundPermission(context, permission, message = "You do not have permission to do this.") {
  if (!refundCan(context, permission)) throw new RefundError(403, message, "PERMISSION_DENIED");
}
