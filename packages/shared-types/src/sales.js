export const SALES_QUOTATION_STATUSES = Object.freeze([
  "draft", "pending_approval", "approved", "sent", "viewed", "accepted",
  "rejected", "expired", "withdrawn", "converted", "cancelled",
]);
export const SALES_ORDER_STATUSES = Object.freeze([
  "draft", "pending_approval", "confirmed", "on_hold", "cancelled", "closed",
]);
export const SALES_APPROVAL_STATUSES = Object.freeze([
  "not_required", "pending", "approved", "rejected", "cancelled",
]);
export const SALES_CREDIT_STATUSES = Object.freeze([
  "not_checked", "passed", "warning", "blocked", "overridden",
]);
export const SALES_FULFILLMENT_STATUSES = Object.freeze([
  "not_started", "partially_allocated", "allocated", "partially_fulfilled", "fulfilled", "cancelled",
]);
export const SALES_BILLING_STATUSES = Object.freeze([
  "not_billable", "ready", "partially_invoiced", "fully_invoiced", "blocked",
]);
export const SALES_REPORT_KEYS = Object.freeze([
  "quotation-conversion", "order-intake", "expiring-quotations", "pending-approvals",
  "active-holds", "fulfillment", "billing-readiness", "customer-performance", "margin",
]);
export const SALES_COMMAND_KEYS = Object.freeze({
  approveQuotation: "sales.quotation.approve",
  approveOrder: "sales.order.approve",
  approveOrderAmendment: "sales.order.amendment.approve",
});
