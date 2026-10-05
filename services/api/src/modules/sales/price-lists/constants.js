// The fixed vocabulary of Sales price lists.
export class PriceListError extends Error {
  constructor(status, message, code = "SALES_PRICE_LIST_ERROR", details = undefined) {
    super(message);
    this.name = "PriceListError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const PRICE_LIST_PERMISSIONS = Object.freeze({
  view: "sales.price_lists.view",
  create: "sales.price_lists.create",
  edit: "sales.price_lists.edit",
  managePrices: "sales.price_lists.manage_prices",
  activate: "sales.price_lists.activate",
  setDefault: "sales.price_lists.set_default",
  changeTaxMode: "sales.price_lists.change_tax_mode",
  import: "sales.price_lists.import",
  export: "sales.price_lists.export",
  overridePrice: "sales.price.override",
});

// Where a document line's list price came from.
export const PRICE_SOURCES = Object.freeze({
  priceList: "price_list",
  priceListBaseUnit: "price_list_base_unit",
  productDefault: "product_default",
  missing: "missing",
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export const text = (value) => String(value ?? "").trim();
export const isUuid = (value) => UUID.test(String(value ?? ""));
export function requireUuid(value, label) {
  if (!isUuid(value)) throw new PriceListError(400, `${label} is not valid.`, "SALES_PRICE_LIST_VALIDATION");
  return String(value);
}
// A date as YYYY-MM-DD, or null. Throws for anything else.
export function optionalDate(value, field, label) {
  const raw = text(value);
  if (!raw) return null;
  const date = raw.slice(0, 10);
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
    throw new PriceListError(400, `${label} must be a date.`, "SALES_PRICE_LIST_VALIDATION", { issues: [{ field, message: `Enter ${label.toLowerCase()} as a date.` }] });
  return date;
}
export const today = () => new Date().toISOString().slice(0, 10);
