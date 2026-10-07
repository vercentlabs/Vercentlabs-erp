// The fixed vocabulary of the Item Master (the shared Products and Services catalogue).
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
  editTax: "products.edit_tax",
  editInventory: "products.edit_inventory",
  manageCategories: "products.manage_categories",
  deleteCategories: "products.delete_categories",
  reclassify: "products.reclassify",
  categoryInventoryDefaults: "products.category_inventory_defaults",
  categoryAccountingDefaults: "products.category_accounting_defaults",
  categoryTaxDefaults: "products.category_tax_defaults",
  manageUnits: "products.manage_units",
  manageIdentifiers: "products.manage_identifiers",
  configureTracking: "products.configure_tracking",
  configureAccounting: "products.configure_accounting",
  viewStock: "products.view_stock",
  viewCost: "products.view_cost",
  editCost: "products.edit_cost",
  generateSku: "products.generate_sku",
  enterSku: "products.enter_sku",
  changeSku: "products.change_sku",
  viewSkuHistory: "products.view_sku_history",
  configureSkuNumbering: "products.configure_sku_numbering",
  manageUomMaster: "products.manage_uom_master",
  changeUomConversions: "products.change_uom_conversions",
  changeDefaultUoms: "products.change_default_uoms",
});

// Stock Item: inventory is tracked. Non-Stock Item: a physical item whose
// quantity is not tracked. Service: no inventory at all. Raw material,
// finished good or consumable are categories, not types.
export const PRODUCT_TYPES = Object.freeze([
  { code: "stock", label: "Stock Item", goods: true },
  { code: "non_stock", label: "Non-Stock Item", goods: true },
  { code: "service", label: "Service", goods: false },
]);

// Draft (being set up, not on any transaction), Active, Inactive (kept for
// history, not chosen on new transactions).
export const LIFECYCLE = Object.freeze({ draft: "draft", active: "active", inactive: "inactive" });
export const LIFECYCLE_LABELS = Object.freeze({ draft: "Draft", active: "Active", inactive: "Inactive" });

export const TRACKING_MODES = Object.freeze([
  { code: "none", label: "None" },
  { code: "batch", label: "Batch / lot" },
  { code: "serial", label: "Serial number" },
]);
export const VALUATION_METHODS = Object.freeze([
  { code: "moving_average", label: "Moving average" },
  { code: "fifo", label: "FIFO" },
  { code: "standard", label: "Standard cost" },
]);
export const IDENTIFIER_TYPES = Object.freeze([
  { code: "barcode", label: "Barcode (UPC / EAN)" },
  { code: "gtin", label: "GTIN" },
  { code: "internal", label: "Internal code" },
]);

export const PRODUCT_VIEWS = Object.freeze([
  { key: "all", label: "All Items" },
  { key: "stock", label: "Stock Items" },
  { key: "non_stock", label: "Non-Stock Items" },
  { key: "services", label: "Services" },
  { key: "batch", label: "Batch Tracked" },
  { key: "serial", label: "Serial Tracked" },
  { key: "templates", label: "Variant Templates" },
  { key: "draft", label: "Draft" },
  { key: "inactive", label: "Inactive" },
]);

export const PRODUCT_FILE_ENTITY = "products.item";

// The type of a stored item.
export const productTypeOf = (row) => (row.item_type === "service" ? "service" : row.track_inventory ? "stock" : "non_stock");
const TYPE_LABELS = new Map(PRODUCT_TYPES.map((entry) => [entry.code, entry.label]));
export const productTypeLabel = (code) => TYPE_LABELS.get(code) ?? code;
const TRACKING_LABELS = new Map(TRACKING_MODES.map((entry) => [entry.code, entry.label]));
export const trackingLabel = (code) => TRACKING_LABELS.get(code) ?? code;
const VALUATION_LABELS = new Map(VALUATION_METHODS.map((entry) => [entry.code, entry.label]));
export const valuationLabel = (code) => VALUATION_LABELS.get(code) ?? code;

// SQL for the type of `alias`.
export const PRODUCT_TYPE_SQL = (alias) => `(CASE WHEN ${alias}.item_type = 'service' THEN 'service' WHEN ${alias}.track_inventory THEN 'stock' ELSE 'non_stock' END)`;
