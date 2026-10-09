// Input normalization and validation for an item (product or service).
import { PRODUCT_TYPES, ProductError, TRACKING_MODES, VALUATION_METHODS } from "./constants.js";
import { normalizeSku, skuProblem } from "./sku.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(PRODUCT_TYPES.map((entry) => entry.code));
const TRACKING = new Set(TRACKING_MODES.map((entry) => entry.code));
const VALUATION = new Set(VALUATION_METHODS.map((entry) => entry.code));
const MAX_AMOUNT = 1_000_000_000_000;
const MAX_MEASURE = 1_000_000;

export const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export const text = (value) => String(value ?? "").trim();
export const isUuid = (value) => UUID.test(String(value ?? ""));

export function requireUuid(value, label) {
  if (!isUuid(value)) throw new ProductError(400, `${label} is not valid.`, "PRODUCT_VALIDATION");
  return String(value);
}

// field -> column, for the fields stored as they are. The code is the SKU.
export const PRODUCT_COLUMNS = Object.freeze({
  code: "code",
  name: "name",
  description: "description",
  salesDescription: "sales_description",
  purchaseDescription: "purchase_description",
  categoryId: "group_id",
  brand: "brand",
  manufacturerName: "manufacturer_name",
  manufacturerPartNumber: "manufacturer_part_number",
  baseUomId: "uom_id",
  salesUomId: "sales_uom_id",
  purchaseUomId: "purchase_uom_id",
  isSellable: "is_sellable",
  isPurchasable: "is_purchasable",
  hsnSacCode: "hsn_sac_code",
  taxCategoryId: "tax_category_id",
  trackingType: "tracking_type",
  requiresExpiryDate: "requires_expiry_date",
  shelfLifeDays: "shelf_life_days",
  valuationMethod: "valuation_method",
  inventoryProfileId: "inventory_profile_id",
  accountingProfileId: "accounting_profile_id",
  standardCost: "standard_cost",
  netWeight: "net_weight",
  grossWeight: "gross_weight",
  weightUomId: "weight_uom_id",
  length: "length",
  width: "width",
  height: "height",
  dimensionUomId: "dimension_uom_id",
  variantAttributes: "variant_attributes",
});

export const PRODUCT_FIELD_LABELS = Object.freeze({
  code: "SKU", name: "Name", type: "Item type", description: "Description", salesDescription: "Sales description", purchaseDescription: "Purchase description",
  categoryId: "Category", brand: "Brand", manufacturerName: "Manufacturer", manufacturerPartNumber: "Manufacturer part number", baseUomId: "Base unit",
  salesUomId: "Sales unit", purchaseUomId: "Purchase unit", isSellable: "Sellable", isPurchasable: "Purchasable", hsnSacCode: "HSN / SAC", taxCategoryId: "Tax category",
  trackingType: "Tracking mode", requiresExpiryDate: "Expiry tracking", shelfLifeDays: "Shelf life", valuationMethod: "Valuation method",
  standardCost: "Standard cost", inventoryProfileId: "Inventory profile", accountingProfileId: "Accounting profile", netWeight: "Net weight", grossWeight: "Gross weight", weightUomId: "Weight unit", length: "Length", width: "Width", height: "Height",
  dimensionUomId: "Dimension unit", variantAttributes: "Variant attributes", salesUomFactor: "Sales unit conversion", purchaseUomFactor: "Purchase unit conversion",
  imageAttachmentId: "Image", barcode: "Barcode",
});

const TEXT_LIMITS = Object.freeze({
  code: 40, name: 240, description: 4000, salesDescription: 4000, purchaseDescription: 4000, brand: 120, manufacturerName: 160, manufacturerPartNumber: 80, hsnSacCode: 8, barcode: 64,
});
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._/-]*$/;
export const IDENTIFIER_PATTERN = /^[0-9A-Za-z._/-]{3,64}$/;

// A decimal from a form or a file: commas and currency signs are formatting; anything else that is not a number stays invalid.
function decimalInput(value) {
  if (value === null || value === undefined || text(value) === "") return null;
  const cleaned = text(value).replace(/[,\s₹]/g, "");
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

function bool(value) {
  if (typeof value === "boolean") return value;
  return ["yes", "y", "true", "1"].includes(text(value).toLowerCase());
}

// Variant attributes: { Size: "Large", Colour: "Black" } — at most 10, names and values short text.
function attributes(value) {
  if (value === null || value === undefined || value === "") return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value).map(([name, entry]) => [text(name), text(entry)]).filter(([name, entry]) => name && entry);
  if (entries.length > 10 || entries.some(([name, entry]) => name.length > 40 || entry.length > 80)) return null;
  return Object.fromEntries(entries);
}

// Returns only the fields present in `input`, trimmed and typed.
export function normalizeProductInput(input = {}) {
  const normalized = {};
  for (const field of ["name", "description", "salesDescription", "purchaseDescription", "brand", "manufacturerName"]) if (has(input, field)) normalized[field] = text(input[field]) || null;
  // The SKU is case-insensitive: stored Unicode-normalized, upper-case, without surrounding spaces.
  if (has(input, "code")) normalized.code = normalizeSku(input.code) || null;
  if (has(input, "sku") && !has(input, "code")) normalized.code = normalizeSku(input.sku) || null;
  if (has(input, "manufacturerPartNumber")) normalized.manufacturerPartNumber = text(input.manufacturerPartNumber).toUpperCase() || null;
  if (has(input, "barcode")) normalized.barcode = text(input.barcode).replace(/\s/g, "") || null;
  if (has(input, "hsnSacCode")) normalized.hsnSacCode = text(input.hsnSacCode).replace(/\s/g, "") || null;
  if (has(input, "type")) normalized.type = text(input.type).toLowerCase() || null;
  for (const field of ["categoryId", "baseUomId", "salesUomId", "purchaseUomId", "taxCategoryId", "imageAttachmentId", "weightUomId", "dimensionUomId", "inventoryProfileId", "accountingProfileId"])
    if (has(input, field)) normalized[field] = text(input[field]) || null;
  for (const field of ["isSellable", "isPurchasable", "requiresExpiryDate"]) if (has(input, field)) normalized[field] = bool(input[field]);
  for (const field of ["trackingType", "valuationMethod"]) if (has(input, field)) normalized[field] = text(input[field]).toLowerCase() || null;
  for (const field of ["standardCost", "salesUomFactor", "purchaseUomFactor", "netWeight", "grossWeight", "length", "width", "height"]) if (has(input, field)) normalized[field] = decimalInput(input[field]);
  if (has(input, "shelfLifeDays")) normalized.shelfLifeDays = input.shelfLifeDays === null || text(input.shelfLifeDays) === "" ? null : Number(text(input.shelfLifeDays));
  if (has(input, "variantAttributes")) normalized.variantAttributes = attributes(input.variantAttributes);
  return normalized;
}

// `candidate` is the item as it would be saved (existing values plus changes).
export function validateProduct(normalized, candidate) {
  const issues = [];
  const issue = (field, message) => issues.push({ field, message });
  if (!text(candidate.name)) issue("name", "Enter the item name.");
  if (!TYPES.has(candidate.type)) issue("type", "Choose Stock Item, Non-Stock Item or Service.");
  if (!isUuid(candidate.baseUomId)) issue("baseUomId", candidate.type === "service" ? "Choose the unit the service is sold in, such as Hour." : "Choose the base unit of measure.");
  for (const [field, maximum] of Object.entries(TEXT_LIMITS)) if (text(normalized[field]).length > maximum) issue(field, `Must be ${maximum} characters or fewer.`);
  if (normalized.code && skuProblem(normalized.code)) issue("code", skuProblem(normalized.code));
  if (normalized.barcode && !IDENTIFIER_PATTERN.test(normalized.barcode)) issue("barcode", "Enter a barcode of 3 to 64 letters or digits.");
  // HSN classifies goods (4, 6 or 8 digits); SAC classifies services (6 digits starting 99).
  if (candidate.hsnSacCode) {
    if (candidate.type === "service" && !/^99[0-9]{4}$/.test(candidate.hsnSacCode)) issue("hsnSacCode", "Enter a 6-digit SAC starting with 99, such as 998313.");
    if (candidate.type !== "service" && (!/^[0-9]{4}([0-9]{2}){0,2}$/.test(candidate.hsnSacCode) || candidate.hsnSacCode.startsWith("99")))
      issue("hsnSacCode", "Enter a 4, 6 or 8-digit HSN code, such as 8471. Codes starting 99 are SAC codes for services.");
  }
  for (const field of ["categoryId", "salesUomId", "purchaseUomId", "taxCategoryId", "imageAttachmentId", "weightUomId", "dimensionUomId", "inventoryProfileId", "accountingProfileId"])
    if (normalized[field] && !isUuid(normalized[field])) issue(field, "Choose from the list.");
  // A service is not stock: no inventory profile.
  if (candidate.type === "service" && candidate.inventoryProfileId) issue("inventoryProfileId", "A service has no inventory profile.");
  if (normalized.standardCost !== null && normalized.standardCost !== undefined && (!Number.isFinite(normalized.standardCost) || normalized.standardCost < 0 || normalized.standardCost > MAX_AMOUNT))
    issue("standardCost", "Enter an amount of zero or more.");
  for (const [factor, uom] of [["salesUomFactor", "salesUomId"], ["purchaseUomFactor", "purchaseUomId"]]) {
    const value = normalized[factor];
    if (value !== null && value !== undefined && (!Number.isFinite(value) || value <= 0 || value > MAX_MEASURE)) issue(factor, "Enter how many base units one of this unit holds, such as 12.");
    if (candidate[uom] && candidate[uom] !== candidate.baseUomId && has(normalized, uom) && (value === null || value === undefined) && !candidate[`${uom}Converts`])
      issue(factor, "Enter how many base units one of this unit holds.");
  }
  if (normalized.trackingType && !TRACKING.has(normalized.trackingType)) issue("trackingType", "Choose None, Batch / lot or Serial number.");
  if (normalized.valuationMethod && !VALUATION.has(normalized.valuationMethod)) issue("valuationMethod", "Choose Moving average or FIFO.");
  // Batch, serial and expiry describe physical stock: only a Stock Item has them.
  if (candidate.type !== "stock" && candidate.trackingType && candidate.trackingType !== "none")
    issue("trackingType", candidate.type === "service" ? "A service cannot be batch or serial tracked." : "Only a Stock Item can be batch or serial tracked.");
  if (candidate.requiresExpiryDate && candidate.trackingType !== "batch") issue("requiresExpiryDate", "Only a batch-tracked item can require expiry dates.");
  if (normalized.shelfLifeDays !== null && normalized.shelfLifeDays !== undefined && (!Number.isInteger(normalized.shelfLifeDays) || normalized.shelfLifeDays < 1 || normalized.shelfLifeDays > 36500))
    issue("shelfLifeDays", "Enter the shelf life in whole days, from 1 to 36500.");
  if (candidate.shelfLifeDays && !candidate.requiresExpiryDate) issue("shelfLifeDays", "Turn on expiry tracking to give a shelf life.");
  for (const field of ["netWeight", "grossWeight", "length", "width", "height"]) {
    const value = normalized[field];
    if (value !== null && value !== undefined && (!Number.isFinite(value) || value < 0 || value > MAX_MEASURE)) issue(field, "Enter a measurement of zero or more.");
  }
  if (Number.isFinite(candidate.netWeight) && Number.isFinite(candidate.grossWeight) && candidate.netWeight !== null && candidate.grossWeight !== null
      && Number(candidate.grossWeight) < Number(candidate.netWeight)) issue("grossWeight", "Gross weight cannot be less than net weight.");
  const weighed = [candidate.netWeight, candidate.grossWeight].some((value) => value !== null && value !== undefined);
  if (weighed && !candidate.weightUomId) issue("weightUomId", "Choose the unit the weight is in.");
  const measured = [candidate.length, candidate.width, candidate.height].some((value) => value !== null && value !== undefined);
  if (measured && !candidate.dimensionUomId) issue("dimensionUomId", "Choose the unit the dimensions are in.");
  if (has(normalized, "variantAttributes") && normalized.variantAttributes === null) issue("variantAttributes", "Give up to 10 attributes, such as Size: Large.");
  if (!candidate.isSellable && !candidate.isPurchasable && candidate.type === "service") issue("isSellable", "A service must be sold or purchased.");
  return issues;
}

export function assertValidProduct(normalized, candidate) {
  const issues = validateProduct(normalized, candidate);
  if (issues.length) throw new ProductError(400, issues[0].message, "PRODUCT_VALIDATION", { issues });
}
