export const STOCK_RESOURCE_KEYS = Object.freeze([
  "balances",
  "movements",
  "transfers",
  "reservations",
  "reorder-rules",
  "batches",
  "serials",
  "counts",
]);
export const STOCK_MOVEMENT_TYPES = Object.freeze([
  "receipt",
  "issue",
  "transfer",
  "adjustment",
  "return",
  "count",
]);
export const STOCK_COSTING_METHODS = Object.freeze(["moving_average", "fifo"]);
export const STOCK_TRANSFER_STATES = Object.freeze([
  "draft",
  "in_transit",
  "completed",
  "cancelled",
]);
