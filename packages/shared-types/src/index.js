export * from "./accounting.js";
export const BUSINESS_DATA_RESOURCE_KEYS = Object.freeze([
  "parties",
  "contacts",
  "addresses",
  "units-of-measure",
  "item-groups",
  "items",
  "tax-categories",
  "tax-rates",
  "warehouses",
  "warehouse-locations",
  "payment-terms",
  "price-lists",
  "fiscal-periods",
  "currencies",
  "exchange-rates",
]);

export const MASTER_DATA_STATUSES = Object.freeze([
  "active",
  "inactive",
  "open",
  "closed",
  "locked",
]);
export * from "./crm.js";
export * from "./billing.js";
export * from "./modules.js";
export * from "./structured-fields.js";
export * from "./sales.js";

export * from "./procurement.js";
export * from "./stock.js";
export * from "./manufacturing.js";
export * from "./projects.js";
