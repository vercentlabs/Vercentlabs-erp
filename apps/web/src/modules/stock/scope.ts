/** Canonical 510-register feature slice for this module. Requirement IDs are permanent evidence identifiers, not source-folder names. */
export const STOCK_FEATURES = Object.freeze([
  ["F097", "Item master"],
  ["F098", "Item categories"],
  ["F099", "SKUs"],
  ["F100", "Variants"],
  ["F101", "Multiple units of measure"],
  ["F102", "UOM conversions"],
  ["F103", "Warehouses"],
  ["F104", "Warehouse locations and bins"],
  ["F105", "Multi-warehouse inventory"],
  ["F106", "Real-time stock balance"],
  ["F107", "Stock ledger"],
  ["F108", "Goods receipts"],
  ["F109", "Goods issues"],
  ["F110", "Internal transfers"],
  ["F111", "Stock adjustments"],
  ["F112", "Stock reservations"],
  ["F113", "Available stock"],
  ["F114", "Available-to-promise"],
] as const);

export type StockFeatureId = (typeof STOCK_FEATURES)[number][0];
