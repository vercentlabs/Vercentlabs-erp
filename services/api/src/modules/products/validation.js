// Input normalization and validation for a product or service.
import { PRODUCT_TYPES, ProductError } from "./constants.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(PRODUCT_TYPES.map((entry) => entry.code));
const MAX_PRICE = 1_000_000_000_000;

export const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export const text = (value) => String(value ?? "").trim();
export const isUuid = (value) => UUID.test(String(value ?? ""));

export function requireUuid(value, label) {
  if (!isUuid(value)) throw new ProductError(400, `${label} is not valid.`, "PRODUCT_VALIDATION");
  return String(value);
}

// field -> column, for the fields stored as they are.
export const PRODUCT_COLUMNS = Object.freeze({
  code: "code",
  name: "name",
  description: "description",
  salesDescription: "sales_description",
  purchaseDescription: "purchase_description",
  categoryId: "group_id",
  sku: "sku",
  barcode: "barcode",
  baseUomId: "uom_id",
  salesUomId: "sales_uom_id",
  purchaseUomId: "purchase_uom_id",
  isSellable: "is_sellable",
  isPurchasable: "is_purchasable",
  hsnSacCode: "hsn_sac_code",
  taxCategoryId: "tax_category_id",
  defaultSalesPrice: "sales_price",
  defaultPurchaseCost: "purchase_price",
  standardCost: "standard_cost",
  trackingType: "tracking_type",
  allowNegativeStock: "allow_negative_stock",
  requiresExpiryDate: "requires_expiry_date",
  valuationMethod: "valuation_method",
});

export const PRODUCT_FIELD_LABELS = Object.freeze({
  code: "Code", name: "Name", type: "Type", description: "Description", salesDescription: "Sales description", purchaseDescription: "Purchase description",
  categoryId: "Category", sku: "SKU", barcode: "Barcode", baseUomId: "Base unit", salesUomId: "Sales unit", purchaseUomId: "Purchase unit", isSellable: "Can be sold",
  isPurchasable: "Can be purchased", hsnSacCode: "HSN / SAC", taxCategoryId: "Tax category", defaultSalesPrice: "Default sales price", defaultPurchaseCost: "Default purchase cost",
  standardCost: "Standard cost", trackingType: "Lot / serial tracking", allowNegativeStock: "Allow negative stock", requiresExpiryDate: "Lots need an expiry date", valuationMethod: "Valuation method", salesUomFactor: "Sales unit conversion", purchaseUomFactor: "Purchase unit conversion", imageAttachmentId: "Image",
});

const TEXT_LIMITS = Object.freeze({ code: 40, name: 240, description: 4000, salesDescription: 4000, purchaseDescription: 4000, sku: 60, barcode: 64, hsnSacCode: 8 });

function money(value) {
  if (value === null || value === undefined || text(value) === "") return null;
  return Number(text(value).replace(/[,\s₹]/g, ""));
}

function bool(value) {
  if (typeof value === "boolean") return value;
  return ["yes", "y", "true", "1"].includes(text(value).toLowerCase());
}

// Returns only the fields present in `input`, trimmed and typed.
export function normalizeProductInput(input = {}) {
  const normalized = {};
  for (const field of ["name", "description", "salesDescription", "purchaseDescription"]) if (has(input, field)) normalized[field] = text(input[field]) || null;
  if (has(input, "code")) normalized.code = text(input.code).toUpperCase() || null;
  if (has(input, "sku")) normalized.sku = text(input.sku).toUpperCase() || null;
  if (has(input, "barcode")) normalized.barcode = text(input.barcode).replace(/\s/g, "") || null;
  if (has(input, "hsnSacCode")) normalized.hsnSacCode = text(input.hsnSacCode).replace(/\s/g, "") || null;
  if (has(input, "type")) normalized.type = text(input.type).toLowerCase() || null;
  for (const field of ["categoryId", "baseUomId", "salesUomId", "purchaseUomId", "taxCategoryId", "imageAttachmentId"]) if (has(input, field)) normalized[field] = text(input[field]) || null;
  for (const field of ["isSellable", "isPurchasable", "allowNegativeStock", "requiresExpiryDate"]) if (has(input, field)) normalized[field] = bool(input[field]);
  for (const field of ["trackingType", "valuationMethod"]) if (has(input, field)) normalized[field] = text(input[field]).toLowerCase() || null;
  for (const field of ["defaultSalesPrice", "defaultPurchaseCost", "standardCost", "salesUomFactor", "purchaseUomFactor"]) if (has(input, field)) normalized[field] = money(input[field]);
  return normalized;
}

// `candidate` is the product as it would be saved (existing values plus changes).
export function validateProduct(normalized, candidate) {
  const issues = [];
  const issue = (field, message) => issues.push({ field, message });
  if (!text(candidate.name)) issue("name", "Enter the name.");
  if (!TYPES.has(candidate.type)) issue("type", "Choose Stock Item, Non-Stock Item or Service.");
  if (!isUuid(candidate.baseUomId)) issue("baseUomId", candidate.type === "service" ? "Choose the unit the service is sold in, such as Hour." : "Choose the base unit of measure.");
  for (const [field, maximum] of Object.entries(TEXT_LIMITS)) if (text(normalized[field]).length > maximum) issue(field, `Must be ${maximum} characters or fewer.`);
  if (normalized.code && !/^[A-Z0-9][A-Z0-9._/-]*$/.test(normalized.code)) issue("code", "Use letters, numbers, dots, dashes or slashes in the code.");
  if (normalized.sku && !/^[A-Z0-9][A-Z0-9._/-]*$/.test(normalized.sku)) issue("sku", "Use letters, numbers, dots, dashes or slashes in the SKU.");
  if (normalized.barcode && !/^[0-9A-Za-z-]{4,64}$/.test(normalized.barcode)) issue("barcode", "Enter a barcode of 4 to 64 letters or digits.");
  // A service has no stock identity.
  if (candidate.type === "service") {
    if (candidate.sku) issue("sku", "A service has no SKU.");
    if (candidate.barcode) issue("barcode", "A service has no barcode.");
  }
  // HSN classifies goods (4, 6 or 8 digits); SAC classifies services (6 digits starting 99).
  if (candidate.hsnSacCode) {
    if (candidate.type === "service" && !/^99[0-9]{4}$/.test(candidate.hsnSacCode)) issue("hsnSacCode", "Enter a 6-digit SAC starting with 99, such as 998313.");
    if (candidate.type !== "service" && (!/^[0-9]{4}([0-9]{2}){0,2}$/.test(candidate.hsnSacCode) || candidate.hsnSacCode.startsWith("99")))
      issue("hsnSacCode", "Enter a 4, 6 or 8-digit HSN code, such as 8471. Codes starting 99 are SAC codes for services.");
  }
  for (const field of ["categoryId", "salesUomId", "purchaseUomId", "taxCategoryId", "imageAttachmentId"]) if (normalized[field] && !isUuid(normalized[field])) issue(field, "Choose from the list.");
  for (const field of ["defaultSalesPrice", "defaultPurchaseCost", "standardCost"]) {
    const value = normalized[field];
    if (value !== null && value !== undefined && (!Number.isFinite(value) || value < 0 || value > MAX_PRICE)) issue(field, "Enter an amount of zero or more.");
  }
  for (const [factor, uom] of [["salesUomFactor", "salesUomId"], ["purchaseUomFactor", "purchaseUomId"]]) {
    const value = normalized[factor];
    if (value !== null && value !== undefined && (!Number.isFinite(value) || value <= 0 || value > 1_000_000)) issue(factor, "Enter how many base units one of this unit holds, such as 10.");
    if (candidate[uom] && candidate[uom] !== candidate.baseUomId && has(normalized, uom) && (value === null || value === undefined) && !candidate[`${uom}Converts`])
      issue(factor, "Enter how many base units one of this unit holds.");
  }
  if (normalized.trackingType && !["none", "batch", "serial"].includes(normalized.trackingType)) issue("trackingType", "Choose None, Lot / batch or Serial number.");
  if (normalized.valuationMethod && !["moving_average", "fifo", "standard"].includes(normalized.valuationMethod)) issue("valuationMethod", "Choose Moving average, FIFO or Standard.");
  if (candidate.type !== "stock" && candidate.trackingType && candidate.trackingType !== "none") issue("trackingType", "Only a Stock Item can be lot or serial tracked.");
  if (candidate.requiresExpiryDate && candidate.trackingType !== "batch") issue("requiresExpiryDate", "Only a lot-tracked product can require an expiry date.");
  if (!candidate.isSellable && !candidate.isPurchasable && candidate.type === "service") issue("isSellable", "A service must be sold or purchased.");
  return issues;
}

export function assertValidProduct(normalized, candidate) {
  const issues = validateProduct(normalized, candidate);
  if (issues.length) throw new ProductError(400, issues[0].message, "PRODUCT_VALIDATION", { issues });
}
