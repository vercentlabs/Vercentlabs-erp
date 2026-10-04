// The fixed vocabulary of the Product and Service master.
export class ProductError extends Error {
  constructor(status, message, code = "PRODUCT_ERROR", details = undefined) {
    super(message);
    this.name = "ProductError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const PRODUCT_PERMISSIONS = Object.freeze({
  view: "products.view",
  create: "products.create",
  edit: "products.edit",
  activate: "products.activate",
  delete: "products.delete",
  import: "products.import",
  export: "products.export",
  editPricing: "products.edit_pricing",
  editTax: "products.edit_tax",
  editInventory: "products.edit_inventory",
  viewCost: "products.view_cost",
  editCost: "products.edit_cost",
});

// Stock Item: inventory is tracked. Non-Stock Item: a physical or commercial
// item whose quantity is not tracked. Service: no inventory at all.
export const PRODUCT_TYPES = Object.freeze([
  { code: "stock", label: "Stock Item", goods: true },
  { code: "non_stock", label: "Non-Stock Item", goods: true },
  { code: "service", label: "Service", goods: false },
]);

export const PRODUCT_VIEWS = Object.freeze([
  { key: "all", label: "All" },
  { key: "products", label: "Products" },
  { key: "services", label: "Services" },
  { key: "stock", label: "Stock Items" },
  { key: "non_stock", label: "Non-Stock Items" },
  { key: "inactive", label: "Inactive" },
]);

export const PRODUCT_NUMBER_DOCUMENT_TYPE = "product";
export const PRODUCT_FILE_ENTITY = "products.item";

// The type of a stored item.
export const productTypeOf = (row) => (row.item_type === "service" ? "service" : row.track_inventory ? "stock" : "non_stock");
const TYPE_LABELS = new Map(PRODUCT_TYPES.map((entry) => [entry.code, entry.label]));
export const productTypeLabel = (code) => TYPE_LABELS.get(code) ?? code;

// SQL for the type of `alias`.
export const PRODUCT_TYPE_SQL = (alias) => `(CASE WHEN ${alias}.item_type = 'service' THEN 'service' WHEN ${alias}.track_inventory THEN 'stock' ELSE 'non_stock' END)`;
