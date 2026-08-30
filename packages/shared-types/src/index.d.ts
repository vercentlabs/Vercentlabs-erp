export * from "./accounting.js";
export const BUSINESS_DATA_RESOURCE_KEYS: readonly [
  "parties",
  "contacts",
  "addresses",
  "units-of-measure",
  "item-groups",
  "items",
  "item-variants",
  "item-uom-conversions",
  "tax-categories",
  "tax-rates",
  "warehouses",
  "warehouse-locations",
  "payment-terms",
  "price-lists",
  "fiscal-periods",
  "currencies",
  "exchange-rates",
];

export type BusinessDataResourceKey =
  (typeof BUSINESS_DATA_RESOURCE_KEYS)[number];

export type MasterDataStatus =
  "active" | "inactive" | "open" | "closed" | "locked";

export type BusinessDataListResponse<T = Record<string, unknown>> = {
  ok: true;
  rows: T[];
  total: number;
  limit: number;
  offset: number;
};

export type BusinessDataMutationResponse = {
  ok: true;
  id: string;
  message: string;
};
export * from "./crm.js";
export * from "./billing.js";
export * from "./modules.js";
export * from "./structured-fields.js";
export * from "./sales.js";

export * from "./procurement.js";
export * from "./stock.js";
export * from "./manufacturing.js";
export * from "./projects.js";
export * from "./assets.js";
export * from "./point-of-sale.js";
export * from "./quality.js";
export * from "./support.js";
export * from "./hr-payroll.js";
