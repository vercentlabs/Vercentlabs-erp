export const POS_RESOURCE_KEYS = Object.freeze([
  "stores",
  "terminals",
  "shifts",
  "sales",
  "payments",
  "returns",
  "cash-movements",
  "reconciliations",
]);

export const POS_SHIFT_STATUSES = Object.freeze([
  "draft",
  "open",
  "closing",
  "closed",
  "cancelled",
]);

export const POS_SALE_STATUSES = Object.freeze([
  "draft",
  "completed",
  "partially_returned",
  "returned",
  "voided",
]);

export const POS_PAYMENT_METHODS = Object.freeze([
  "cash",
  "card",
  "upi",
  "bank_transfer",
  "wallet",
  "store_credit",
]);
