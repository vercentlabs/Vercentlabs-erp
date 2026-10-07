// The fixed vocabulary of purchase orders.
//
// An order has four lifecycle states. Receiving, billing and payment are not
// part of that state: each is worked out from the goods receipts, supplier
// bills and Accounts Payable themselves. Sending the order and the supplier's
// acknowledgement are a communication status beside it.
export const STATUS = Object.freeze({ draft: "draft", confirmed: "confirmed", closed: "closed", cancelled: "cancelled" });
export const STATUS_LABELS = Object.freeze({ draft: "Draft", confirmed: "Confirmed", closed: "Closed", cancelled: "Cancelled" });
export const COMMUNICATION_LABELS = Object.freeze({ not_sent: "Not sent", sent: "Sent", acknowledged: "Acknowledged" });
export const RECEIPT_LABELS = Object.freeze({
  not_required: "Not required", not_received: "Not received", partially_received: "Partially received", fully_received: "Fully received",
  complete_with_cancellations: "Complete with cancellations",
});
export const BILLING_LABELS = Object.freeze({ not_billed: "Not billed", partially_billed: "Partially billed", fully_billed: "Fully billed",
  complete_with_cancellation: "Complete with cancellation", overbilled: "Overbilled" });
export const PAYMENT_LABELS = Object.freeze({ no_payable: "No payable yet", unpaid: "Unpaid", partially_paid: "Partially paid", paid: "Paid" });
export const PRODUCT_TYPE_LABELS = Object.freeze({ stock: "Stock item", non_stock: "Non-stock item", service: "Service" });

export const CANCEL_REASONS = Object.freeze([
  { code: "supplier_cannot_supply", label: "Supplier cannot supply" },
  { code: "no_longer_needed", label: "No longer needed" },
  { code: "ordered_elsewhere", label: "Ordered elsewhere" },
  { code: "price_or_terms", label: "Price or terms not agreed" },
  { code: "duplicate_order", label: "Duplicate order" },
  { code: "short_supply_accepted", label: "Short supply accepted" },
  { code: "other", label: "Other" },
]);
export const SENT_CHANNELS = Object.freeze([
  { code: "email_outside", label: "Email from my own mailbox" },
  { code: "portal", label: "Supplier portal" },
  { code: "hand_delivered", label: "Handed over" },
  { code: "phone", label: "Phone" },
  { code: "other", label: "Other" },
]);

export const PO_PERMISSIONS = Object.freeze({
  view: "procurement.po.view",
  viewAll: "procurement.po.view_all",
  create: "procurement.po.create",
  confirm: "procurement.po.confirm",
  amend: "procurement.po.amend",
  cancel: "procurement.po.cancel",
  close: "procurement.po.close",
  send: "procurement.po.send",
  overridePrice: "procurement.po.override_price",
  changeWarehouse: "procurement.po.change_warehouse",
  updateDates: "procurement.po.update_dates",
  descriptiveLines: "procurement.po.descriptive_lines",
  receive: "procurement.receipts.manage",
  post: "procurement.receipts.post",
  reverse: "procurement.receipts.reverse",
  release: "procurement.receipts.release",
  receivingAccess: "procurement.receipts.access",
  returns: "procurement.returns.manage",
  quotations: "procurement.quotations.manage",
  bill: "accounting.payables.manage",
  overrideMatch: "procurement.matching.override",
  viewPayables: "procurement.suppliers.payables.view",
  settings: "procurement.settings.manage",
  rejectionsView: "procurement.rejections.view",
  rejectionsViewAll: "procurement.rejections.view_all",
  rejectionsRecord: "procurement.rejections.record",
  rejectionsEdit: "procurement.rejections.edit",
  rejectionsCancel: "procurement.rejections.cancel",
  rejectionsQuality: "procurement.rejections.quality",
  rejectionsResolve: "procurement.rejections.resolve",
  rejectionsOverride: "procurement.rejections.override",
  rejectionsDispose: "procurement.rejections.dispose",
  rejectionsFinancial: "procurement.rejections.financial",
  changePaymentTerms: "procurement.po.change_payment_terms",
  complianceView: "procurement.compliance.view",
  recordAdvance: "accounting.payments.manage",
});

// The spec's views first (receiving and billing ones are derived filters, not statuses), then the operational queues.
export const PO_VIEWS = Object.freeze([
  { key: "all", label: "All Purchase Orders" },
  { key: "draft", label: "Draft" },
  { key: "confirmed", label: "Confirmed" },
  { key: "partially_received", label: "Partially Received" },
  { key: "fully_received", label: "Fully Received" },
  { key: "awaiting_billing", label: "Pending Billing" },
  { key: "partially_billed", label: "Partially Billed" },
  { key: "closed", label: "Closed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "awaiting_receipt", label: "Awaiting Receipt" },
  { key: "overdue_receipt", label: "Overdue Receipt" },
  { key: "billing_mismatch", label: "Billing Mismatches" },
  { key: "ready_to_close", label: "Ready to Close" },
  { key: "with_rejections", label: "Open Rejections" },
  { key: "mine", label: "My Orders" },
  { key: "needs_attention", label: "Needs Attention" },
]);

export class PurchaseOrderError extends Error {
  constructor(status, message, code = "PURCHASE_ORDER_ERROR", details = undefined) {
    super(message);
    this.name = "PurchaseOrderError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value) => UUID.test(String(value ?? ""));
export function requireUuid(value, label = "Purchase order") {
  if (!isUuid(value)) throw new PurchaseOrderError(400, `${label} is not valid.`, "PURCHASE_ORDER_VALIDATION", { field: label });
  return String(value);
}
export const optionalUuid = (value, label) => (value ? requireUuid(value, label) : null);
export const text = (value, maximum = 4000) => {
  const result = value == null ? null : String(value).trim();
  return result ? result.slice(0, maximum) : null;
};
export const has = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);
export const dayOf = (value) => {
  if (!value) return null;
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return String(value).slice(0, 10);
};
export function readDate(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const day = dayOf(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(new Date(`${day}T00:00:00Z`).getTime()))
    throw new PurchaseOrderError(400, `${label} is not a valid date.`, "PURCHASE_ORDER_VALIDATION", { field: label });
  return day;
}
export const fail = (message, field, code = "PURCHASE_ORDER_VALIDATION", status = 400) => {
  throw new PurchaseOrderError(status, message, code, field ? { field } : undefined);
};
