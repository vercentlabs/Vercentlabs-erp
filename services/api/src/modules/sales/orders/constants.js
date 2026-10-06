// The fixed vocabulary of sales orders.
//
// An order has four lifecycle states. What has been reserved, delivered and
// invoiced is not part of that state: fulfilment and invoicing each have
// their own status, worked out from the reservations, deliveries and
// invoices themselves. Payment belongs to the invoice, not to the order.
export const STATUS = Object.freeze({ draft: "draft", confirmed: "confirmed", cancelled: "cancelled", closed: "closed" });
export const STATUS_LABELS = Object.freeze({ draft: "Draft", confirmed: "Confirmed", cancelled: "Cancelled", closed: "Closed" });

// Fulfilment is about delivery only: what was dispatched against what is
// still ordered. Reservation has its own status (../reservations). Stored
// codes keep the values the order table allows; these are the names shown.
export const FULFILLMENT = Object.freeze({ notStarted: "not_started", partiallyDelivered: "partially_fulfilled", delivered: "fulfilled", cancelled: "cancelled" });
// What is shown for fulfilment and invoicing is derived in ../order-tracking/derive.js; these are the codes the order table stores.
export const INVOICING = Object.freeze({ notBillable: "not_billable", notInvoiced: "ready", partiallyInvoiced: "partially_invoiced", fullyInvoiced: "fully_invoiced", blocked: "blocked" });
export const CANCEL_REASONS = Object.freeze([
  { code: "customer_cancelled", label: "Customer cancelled" },
  { code: "product_unavailable", label: "Product unavailable" },
  { code: "pricing_error", label: "Pricing error" },
  { code: "duplicate_order", label: "Duplicate order" },
  { code: "order_replaced", label: "Order replaced" },
  { code: "other", label: "Other" },
]);

export const ORDER_PERMISSIONS = Object.freeze({
  view: "sales.order.view",
  viewTeam: "sales.order.view_team",
  viewAll: "sales.order.view_all",
  create: "sales.order.create",
  changePaymentTerms: "sales.order.change_payment_terms",
  confirm: "sales.order.confirm",
  reopen: "sales.order.reopen",
  cancel: "sales.order.cancel",
  cancelRemaining: "sales.order.cancel_remaining",
  close: "sales.order.close",
  reopenClosed: "sales.order.reopen_closed",
  reserve: "sales.order.reserve",
  deliver: "sales.fulfillment.request",
  invoice: "sales.invoice.request",
  export: "sales.order.export",
  overridePrice: "sales.price.override",
  applyDiscount: "sales.discount.apply",
  viewCost: "sales.margin.view",
  sendConfirmation: "sales.order.confirmation.send",
  markConfirmationSent: "sales.order.confirmation.mark_sent",
  acknowledgeConfirmation: "sales.order.confirmation.acknowledge",
  confirmQuoteVariance: "sales.order.confirm_quote_variance",
  checkAvailability: "sales.availability.check",
  changeWarehouse: "sales.order.change_warehouse",
  viewReservations: "sales.reservation.view",
  releaseReservation: "sales.reservation.release",
});

export const ORDER_VIEWS = Object.freeze([
  { key: "all", label: "All Orders" },
  { key: "draft", label: "Draft" },
  { key: "confirmed", label: "Confirmed" },
  { key: "awaiting_reservation", label: "Awaiting Reservation" },
  { key: "partially_reserved", label: "Partially Reserved" },
  { key: "awaiting_delivery", label: "Awaiting Delivery" },
  { key: "partially_delivered", label: "Partially Delivered" },
  { key: "overdue_delivery", label: "Overdue Delivery" },
  { key: "ready_to_invoice", label: "Ready to Invoice" },
  { key: "partially_invoiced", label: "Partially Invoiced" },
  { key: "fully_invoiced", label: "Fully Invoiced" },
  { key: "closed", label: "Closed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "needs_attention", label: "Needs Attention" },
  { key: "mine", label: "My Orders" },
  { key: "team", label: "Team Orders" },
  { key: "confirmation_not_sent", label: "Confirmation Not Sent" },
  { key: "confirmation_sent", label: "Confirmation Sent" },
  { key: "delivered", label: "Fully Delivered" },
  { key: "not_invoiced", label: "Not Invoiced" },
]);

export class OrderError extends Error {
  constructor(status, message, code = "SALES_ORDER_ERROR", details = undefined) {
    super(message);
    this.name = "OrderError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value) => UUID.test(String(value ?? ""));
export function requireUuid(value, label = "Sales order") {
  if (!isUuid(value)) throw new OrderError(400, `${label} is not valid.`, "SALES_ORDER_VALIDATION");
  return String(value);
}
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
