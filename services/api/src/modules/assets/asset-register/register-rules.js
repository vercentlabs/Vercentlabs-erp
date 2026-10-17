// Assets — Asset Register, the rules: permissions and errors, who sees which assets (a custodian sees the assets in their care; asset
// managers, Finance and auditors the Company's register), the lifecycle and which transitions each action makes, and the labels. The
// Register owns an asset's identity, custody and operational history; Finance owns capitalization and carrying value.
import { AssetError, has } from "../common.js";

export const ASSET = Object.freeze({
  view: "assets.view", create: "assets.create", editDraft: "assets.edit_draft", editDetails: "assets.edit_details", registerBulk: "assets.register_bulk",
  import: "assets.import", export: "assets.export", activate: "assets.activate", assign: "assets.assign", verify: "assets.verify", viewFinancials: "assets.view_financials",
  acquisition: "assets.manage_acquisition_link", retire: "assets.retire_or_dispose", categories: "assets.manage_categories", audit: "assets.audit.view",
  manage: "assets.manage", capitalize: "assets.capitalize", reports: "assets.reports.view",
});
// Anyone holding one of these sees the Company register; someone with only assets.view sees the assets in their care.
const BROAD = [ASSET.manage, ASSET.create, ASSET.editDetails, ASSET.registerBulk, ASSET.import, ASSET.activate, ASSET.verify, ASSET.viewFinancials, ASSET.acquisition, ASSET.retire,
  ASSET.categories, ASSET.audit, ASSET.reports, ASSET.capitalize, "assets.transfer", "assets.maintain", "assets.dispose", "assets.depreciate", "assets.inspect", ASSET.assign];
export const seesRegister = (c) => BROAD.some((key) => has(c, key));
export const seesFinancials = (c) => has(c, ASSET.viewFinancials) || has(c, ASSET.capitalize);

export const LIFECYCLE = Object.freeze({ DRAFT: "Draft", REGISTERED: "Registered", ACTIVE: "Active", ON_HOLD: "On hold", RETIRED: "Retired", DISPOSED: "Disposed", LOST: "Lost" });
export const AVAILABILITY = Object.freeze({ AVAILABLE: "Available", ASSIGNED: "Assigned", MAINTENANCE: "Under maintenance", RESTRICTED: "Restricted" });
export const CONDITION = Object.freeze({ NEW: "New", GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged", UNSERVICEABLE: "Unserviceable" });
export const CONDITION_UNKNOWN = "Unknown (not yet verified)";
export const ASSET_TYPE = Object.freeze({ TANGIBLE: "Tangible fixed asset", INTANGIBLE: "Intangible (software, licence)", UNDER_CONSTRUCTION: "Under construction / not commissioned",
  LOW_VALUE: "Low-value tracked item", EXTERNAL: "Leased or third-party" });
export const CAPITALIZATION = Object.freeze({ PENDING: "Fixed asset — Finance to confirm", CAPITALIZED: "Capitalized by Finance", TRACKED_ONLY: "Tracked equipment (not capitalized)" });
export const OWNERSHIP = Object.freeze({ owned: "Company-owned", leased: "Leased", loaned: "Borrowed / third-party" });
export const ACQUISITION_METHOD = Object.freeze({ PURCHASE: "Purchased from a supplier", OPENING_BALANCE: "Already owned (opening register)", CONTRIBUTION: "Contributed", TRANSFER_IN: "Transferred in", OTHER: "Other approved source" });
export const SOURCE_TYPE = Object.freeze({ SUPPLIER_INVOICE_LINE: "Supplier invoice line", GOODS_RECEIPT_LINE: "Goods receipt line", PURCHASE_ORDER_LINE: "Purchase order line",
  OPENING_BALANCE: "Opening register", MANUAL_EXCEPTION: "Approved exception (no purchase document)" });
export const VERIFICATION = Object.freeze({ FOUND: "Found as expected", NOT_FOUND: "Not found", WRONG_LOCATION: "Found elsewhere", DAMAGED: "Found damaged" });

const MESSAGES = Object.freeze({
  ASSET_NAME_REQUIRED: "Enter an asset name.",
  ASSET_CATEGORY_INVALID: "Select a valid asset category.",
  ASSET_SERIAL_DUPLICATE: "An asset with this serial number may already exist.",
  ASSET_TAG_DUPLICATE: "Another asset already carries this asset tag.",
  ASSET_SOURCE_ALREADY_ALLOCATED: "This purchase quantity is already registered.",
  ASSET_SOURCE_COMPANY_MISMATCH: "The acquisition source belongs to another Company.",
  ASSET_SOURCE_INVALID: "This purchase line cannot be used to register an asset.",
  ASSET_COST_REVIEW_REQUIRED: "Finance must verify the asset's acquisition cost.",
  ASSET_LOCATION_INVALID: "Select an authorized location.",
  ASSET_CUSTODIAN_INVALID: "Select an eligible Company user.",
  ASSET_ACTIVATION_INCOMPLETE: "Complete the required details before activating.",
  ASSET_NOT_AVAILABLE: "This asset cannot be assigned in its current state.",
  ASSET_ALREADY_DISPOSED: "This asset has already been disposed of.",
  ASSET_STATE_INVALID: "This action is not available in the asset's current state.",
  ASSET_CUSTODY_BY_TRANSFER: "Once an asset is active, its location and custodian change through a transfer or assignment.",
  ASSET_MIGRATION_VALIDATION_FAILED: "Some imported asset rows need correction.",
  ASSET_PERMISSION_DENIED: "You are not authorized to perform this action.",
  ASSET_VERSION_CONFLICT: "This asset changed. Refresh and review.",
  ASSET_OPERATION_UNKNOWN: "Checking the earlier operation. Do not submit it again.",
  ASSET_NOT_FOUND: "This asset is not available.",
  ASSET_INPUT_INVALID: "Check the details and try again.",
  ASSET_IDENTIFIER_EDIT_DENIED: "You cannot change this identifier.",
  ASSET_LOCATION_TRANSFER_REQUIRED: "Use the Asset Transfer workflow to change the registered location.",
});
export const ASSET_MESSAGES = MESSAGES;
export const assetError = (status, code, message, details) => {
  const error = new AssetError(status, message ?? MESSAGES[code] ?? "Check the details and try again.", code);
  if (details) error.details = details;
  return error;
};
export const requirePermission = (c, key) => { if (!has(c, key)) throw assetError(403, "ASSET_PERMISSION_DENIED"); };

// The one lifecycle state machine: each action, the states it starts from and where it leads (a released hold returns to where it began).
// Anything else is refused with ASSET_STATUS_INVALID_TRANSITION. Disposal is not here: only the Disposal workflow disposes of an asset.
export const TRANSITIONS = Object.freeze({
  register: { from: ["DRAFT"], to: "REGISTERED", permission: ASSET.create },
  activate: { from: ["REGISTERED"], to: "ACTIVE", permission: ASSET.activate },
  hold: { from: ["REGISTERED", "ACTIVE"], to: "ON_HOLD", permission: "assets.status.place_hold" },
  release: { from: ["ON_HOLD"], to: "ORIGIN", permission: "assets.status.release_hold" },
  retire: { from: ["ACTIVE", "ON_HOLD"], to: "RETIRED", permission: ASSET.retire },
  "confirm-lost": { from: ["ACTIVE", "ON_HOLD"], to: "LOST", permission: "assets.status.confirm_lost" },
  recover: { from: ["LOST"], to: "ACTIVE", permission: "assets.status.recover" },
  reinstate: { from: ["RETIRED"], to: "ACTIVE", permission: "assets.status.reinstate" },
});
export const EDITABLE_DRAFT = ["name", "description", "categoryId", "assetType", "ownership", "capitalizationClass", "acquisitionMethod", "manufacturer", "model", "serialNumber", "tagCode",
  "purchaseDate", "receivedDate", "supplierId", "locationId", "departmentId", "custodianUserId", "condition", "criticality", "warrantyProvider", "warrantyReference", "warrantyStartDate",
  "warrantyEndDate", "supportContact", "notes", "parentAssetId"];
// After registration: the non-financial details. Location and custodian only until the asset is commissioned; then transfers own them.
// The serial number and the tag change after registration only through Asset Identification's recorded corrections.
export const EDITABLE_DETAILS = ["name", "description", "manufacturer", "model", "condition", "criticality", "warrantyProvider", "warrantyReference",
  "warrantyStartDate", "warrantyEndDate", "supportContact", "notes"];
export const PRE_ACTIVE_CUSTODY = ["locationId", "departmentId", "custodianUserId"];
