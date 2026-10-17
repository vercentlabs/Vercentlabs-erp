// Assets — Asset Categories, the rules: permissions, the operational policies a category sets for registration, the Finance references kept
// apart (only Finance sets them; only those allowed see them), the starter templates, and the errors. A category suggests and validates; it
// never capitalizes, depreciates or posts anything, and an asset keeps the policy version it was registered under.
import { AssetError, has } from "../common.js";

export const CATEGORY = Object.freeze({
  view: "assets.view", create: "assets.category.create", edit: "assets.category.edit", deactivate: "assets.category.deactivate", reclassify: "assets.category.reclassify",
  manageFinance: "assets.category.manage_financial_policy", viewFinance: "assets.category.view_financial_policy", export: "assets.category.export", history: "assets.category.view_history",
  legacyManage: "assets.manage_categories",
});
// The MVP-9 umbrella permission still allows the operational setup.
export const mayCreate = (c) => has(c, CATEGORY.create) || has(c, CATEGORY.legacyManage);
export const mayEdit = (c) => has(c, CATEGORY.edit) || has(c, CATEGORY.legacyManage);
export const mayDeactivate = (c) => has(c, CATEGORY.deactivate) || has(c, CATEGORY.legacyManage);
export const seesFinance = (c) => has(c, CATEGORY.viewFinance) || has(c, CATEGORY.manageFinance);

export const ASSET_TYPES = Object.freeze({ TANGIBLE: "Physical (tangible)", INTANGIBLE: "Non-physical (intangible)" });
export const GUIDANCE = Object.freeze({ CAPITALIZE: "Normally a fixed asset", TRACK_ONLY: "Normally tracked only", REVIEW: "Finance decides for each asset" });
export const SERIAL_POLICY = Object.freeze({ REQUIRED: "Required", OPTIONAL: "Optional", NOT_APPLICABLE: "Not applicable" });
export const TAG_POLICY = Object.freeze({ REQUIRED: "Required", OPTIONAL: "Optional" });
export const CUSTODIAN_POLICY = Object.freeze({ ALLOWED: "Can be assigned to a person", REQUIRED: "Must be assigned to a person when in use", NOT_APPLICABLE: "Not assigned to people" });
export const OWNERSHIP_APPLICABILITY = Object.freeze({ ANY: "Owned or external", OWNED_ONLY: "Company-owned only", EXTERNAL_ONLY: "Leased or third-party only" });
// The operational rules, which a version snapshot records.
export const OPERATIONAL = ["assetType", "capitalizationGuidance", "serialNumberPolicy", "assetTagPolicy", "locationRequired", "custodianPolicy", "warrantyApplicable", "maintenanceApplicable",
  "verificationApplicable", "scrapEvidenceRequired", "suggestedCondition", "defaultDepartmentId", "ownershipApplicability"];
// The Finance references: set only with the financial-policy permission, seen only by those allowed.
export const FINANCE = ["accountingClass", "depreciationMethod", "usefulLifeMonths", "residualValuePercent", "decliningRate", "depreciationConvention", "taxDepreciationReference", "capitalizationThreshold",
  "assetAccountId", "accumulatedDepreciationAccountId", "depreciationExpenseAccountId", "gainLossAccountId", "disposalLossAccountId", "proceedsAccountId", "cwipAccountId", "financePolicyEffectiveFrom"];
export const COLUMN = Object.freeze({
  name: "name", description: "description", assetType: "asset_type", capitalizationGuidance: "capitalization_guidance", serialNumberPolicy: "serial_number_policy", assetTagPolicy: "asset_tag_policy",
  locationRequired: "location_required", custodianPolicy: "custodian_policy", warrantyApplicable: "warranty_applicable", maintenanceApplicable: "maintenance_applicable", scrapEvidenceRequired: "scrap_evidence_required",
  verificationApplicable: "verification_applicable", suggestedCondition: "suggested_condition", defaultDepartmentId: "default_department_id", ownershipApplicability: "ownership_applicability",
  accountingClass: "accounting_class", depreciationMethod: "depreciation_method", usefulLifeMonths: "useful_life_months", residualValuePercent: "residual_value_percent", decliningRate: "declining_rate",
  depreciationConvention: "depreciation_convention", taxDepreciationReference: "tax_depreciation_reference", capitalizationThreshold: "capitalization_threshold", assetAccountId: "asset_account_id",
  accumulatedDepreciationAccountId: "accumulated_depreciation_account_id", depreciationExpenseAccountId: "depreciation_expense_account_id", gainLossAccountId: "gain_loss_account_id", disposalLossAccountId: "disposal_loss_account_id", proceedsAccountId: "proceeds_account_id", cwipAccountId: "cwip_account_id",
  financePolicyEffectiveFrom: "finance_policy_effective_from",
});
// Starter templates — examples a Company chooses from, never created unasked. [key, name, type, guidance, serial, tag, location, custodian, warranty, maintenance, description]
export const TEMPLATES = Object.freeze([
  ["computers", "Computers & Laptops", "TANGIBLE", "REVIEW", "REQUIRED", "REQUIRED", true, "ALLOWED", true, true, "Desktops, laptops and workstations — serial and custody tracking"],
  ["it-network", "IT & Network Equipment", "TANGIBLE", "REVIEW", "REQUIRED", "OPTIONAL", true, "ALLOWED", true, true, "Servers, routers and switches — serial and location tracking"],
  ["furniture", "Office Furniture", "TANGIBLE", "REVIEW", "OPTIONAL", "OPTIONAL", true, "ALLOWED", false, false, "Desks, chairs and cabinets — location tracking"],
  ["office-equipment", "Office Equipment", "TANGIBLE", "REVIEW", "OPTIONAL", "OPTIONAL", true, "ALLOWED", true, true, "Printers, projectors and scanners — warranty and custody"],
  ["plant", "Plant & Machinery", "TANGIBLE", "CAPITALIZE", "OPTIONAL", "REQUIRED", true, "NOT_APPLICABLE", true, true, "Manufacturing machines — location and maintenance"],
  ["vehicles", "Vehicles", "TANGIBLE", "CAPITALIZE", "REQUIRED", "OPTIONAL", true, "ALLOWED", true, true, "Cars and delivery vans — identification and maintenance"],
  ["electrical", "Electrical Equipment", "TANGIBLE", "REVIEW", "OPTIONAL", "OPTIONAL", true, "NOT_APPLICABLE", true, true, "Air conditioners, UPS and generators — warranty and maintenance"],
  ["tools", "Tools & Instruments", "TANGIBLE", "REVIEW", "OPTIONAL", "REQUIRED", false, "ALLOWED", true, true, "Measurement tools and drills — custody and verification"],
  ["buildings", "Buildings & Improvements", "TANGIBLE", "CAPITALIZE", "NOT_APPLICABLE", "OPTIONAL", true, "NOT_APPLICABLE", false, true, "Qualifying property improvements — Finance classification"],
  ["software", "Software & Licenses", "INTANGIBLE", "REVIEW", "OPTIONAL", "OPTIONAL", false, "ALLOWED", false, false, "Qualifying intangible assets — Finance review"],
  ["low-value", "Low-Value Equipment", "TANGIBLE", "TRACK_ONLY", "OPTIONAL", "OPTIONAL", false, "ALLOWED", false, false, "Headsets and small accessories — tracked only"],
  ["other", "Other", "TANGIBLE", "REVIEW", "OPTIONAL", "OPTIONAL", false, "ALLOWED", true, true, "Company-specific assets"],
]);

const MESSAGES = Object.freeze({
  ASSET_CATEGORY_NAME_REQUIRED: "Enter a category name.",
  ASSET_CATEGORY_DUPLICATE: "A category with this name already exists.",
  ASSET_CATEGORY_INVALID_TYPE: "Select a valid asset type.",
  ASSET_CATEGORY_POLICY_INVALID: "Review the category tracking settings.",
  ASSET_CATEGORY_FINANCE_POLICY_INVALID: "Select an authorized Finance policy.",
  ASSET_CATEGORY_INACTIVE: "This category cannot be used for new Assets.",
  ASSET_CATEGORY_IN_USE: "This category is used by existing Assets and cannot be deleted.",
  ASSET_CATEGORY_RECLASSIFICATION_REVIEW: "Finance must review this category change.",
  ASSET_CATEGORY_REQUIRED_FIELD_MISSING: "Complete the required asset information for the new category.",
  ASSET_CATEGORY_COMPANY_MISMATCH: "This category belongs to another Company.",
  ASSET_CATEGORY_PERMISSION_DENIED: "You are not authorized to perform this action.",
  ASSET_CATEGORY_VERSION_CONFLICT: "This category changed. Refresh and review.",
  ASSET_CATEGORY_OPERATION_UNKNOWN: "Checking the previous action. Please don't submit it again yet.",
  ASSET_CATEGORY_NOT_FOUND: "This category is not available.",
});
export const CATEGORY_MESSAGES = MESSAGES;
export const categoryError = (status, code, message, details) => {
  const error = new AssetError(status, message ?? MESSAGES[code] ?? "Check the details and try again.", code);
  if (details) error.details = details;
  return error;
};
export const normalizedName = (name) => String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// The rules a category sets for an asset's registration and commissioning: what is missing, given the asset's details.
export function categoryRequirements(category, asset, stage) {
  const missing = [];
  // A placeholder such as N/A recorded in older data does not count (the normalized value is empty).
  const present = (raw, normalized) => Boolean(raw) && normalized !== null;
  if (category.serial_number_policy === "REQUIRED" && !present(asset.serial_number, asset.serial_normalized)) missing.push("a serial number");
  if (category.asset_tag_policy === "REQUIRED" && !present(asset.tag_code, asset.tag_normalized)) missing.push("an asset tag");
  if (category.location_required && !asset.location_id) missing.push("a location");
  if (category.custodian_policy === "NOT_APPLICABLE" && asset.current_user_id) missing.push("no custodian (this category is not assigned to people)");
  if (stage === "activate" && category.custodian_policy === "REQUIRED" && !asset.current_user_id) missing.push("a custodian");
  if (category.ownership_applicability === "OWNED_ONLY" && asset.ownership && asset.ownership !== "owned") missing.push("Company ownership (this category is for Company-owned assets)");
  if (category.ownership_applicability === "EXTERNAL_ONLY" && asset.ownership === "owned") missing.push("leased or third-party ownership (this category is for external assets)");
  return missing;
}
