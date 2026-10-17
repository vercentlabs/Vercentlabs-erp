// Assets — Opening / Existing Assets, the rules: permissions, batch and row states, the template columns (with the header names people
// actually use), how an earlier register's status maps to the lifecycle, and the errors. A migration brings in facts and a cutover
// position; it never pretends old purchases, transfers or acknowledgments happened inside Vercentlabs, and it never posts.
import { AssetError, has } from "../common.js";

export const OPENING = Object.freeze({
  view: "assets.view", create: "assets.opening.create", upload: "assets.opening.upload", edit: "assets.opening.edit_draft", validate: "assets.opening.validate",
  register: "assets.opening.register", financials: "assets.opening.view_financials", approve: "assets.opening.approve_financials", close: "assets.opening.close",
  correct: "assets.opening.correct", export: "assets.opening.export", audit: "assets.opening.view_audit",
});
export const seesOpening = (c) => Object.values(OPENING).some((k) => k !== OPENING.view && has(c, k));
export const seesOpeningValues = (c) => has(c, OPENING.financials) || has(c, OPENING.approve) || has(c, OPENING.upload);

export const BATCH_STATUS = Object.freeze({
  DRAFT: "Draft", NEEDS_CORRECTION: "Needs correction", READY_FOR_CONFIRMATION: "Ready to register", REGISTERING: "Registering", REGISTERED_PENDING_FINANCE: "Registered — Finance to review",
  RECONCILED: "Reconciled by Finance", CLOSED: "Closed", CANCELLED: "Cancelled", RECOVERY_REQUIRED: "Needs recovery",
});
export const ROW_STATUS = Object.freeze({ PENDING: "Not validated", INVALID: "Needs correction", DUPLICATE: "Possible duplicate", VALID: "Ready", REGISTERED: "Registered", LINKED: "Linked to an existing asset", SKIPPED: "Skipped" });
export const POSITION_STATUS = Object.freeze({ PROPOSED: "Proposed", NEEDS_REVIEW: "Needs Finance review", APPROVED: "Approved by Finance", LOCKED: "Locked" });

// The template, in order. Header aliases are what spreadsheets usually say.
export const COLUMNS = Object.freeze(["name", "existing_asset_code", "category", "manufacturer", "model", "serial_number", "asset_tag", "ownership", "tracking", "acquisition_date",
  "available_for_use_date", "original_cost", "capitalized_cost", "accumulated_depreciation", "accumulated_impairment", "other_adjustments", "opening_book_value", "residual_value",
  "depreciation_method", "useful_life_months", "remaining_useful_life_months", "currency", "tax_reference", "evidence", "supplier", "purchase_reference", "location", "store",
  "custodian_email", "department", "status", "condition", "warranty_end_date", "disposal_date", "notes"]);
export const HEADER_ALIASES = Object.freeze({
  asset_name: "name", asset: "name", old_code: "existing_asset_code", legacy_code: "existing_asset_code", previous_code: "existing_asset_code", asset_category: "category",
  serial: "serial_number", tag: "asset_tag", ownership_type: "ownership", purchase_date: "acquisition_date", cost: "original_cost", opening_nbv: "opening_book_value",
  opening_carrying_value: "opening_book_value", net_book_value: "opening_book_value", remaining_useful_life: "remaining_useful_life_months", remaining_life_months: "remaining_useful_life_months",
  useful_life: "useful_life_months", custodian: "custodian_email", assigned_to: "custodian_email", asset_status: "status", warranty_expiry: "warranty_end_date", depreciation_policy: "depreciation_method",
  asset_store: "store",
});
export const EXAMPLE = Object.freeze({ name: "Dell Latitude Laptop", existing_asset_code: "LAP-001", category: "Computers & Laptops", manufacturer: "Dell", model: "Latitude 5450",
  serial_number: "DL123ABC", asset_tag: "IT-LAP-001", ownership: "owned", tracking: "fixed", acquisition_date: "2023-04-01", available_for_use_date: "2023-04-05", original_cost: "75000",
  accumulated_depreciation: "45000", accumulated_impairment: "0", opening_book_value: "30000", residual_value: "0", depreciation_method: "straight_line", useful_life_months: "60",
  remaining_useful_life_months: "24", currency: "INR", evidence: "Purchase invoice on file", location: "Pune Office", custodian_email: "person@example.com", department: "Engineering",
  status: "active", condition: "GOOD", warranty_end_date: "2027-04-01", notes: "Existing company laptop" });

// An earlier register's status → { lifecycle, hold?, missing?, lost?, disposed?, store? }. Anything else is flagged for review.
export const STATUS_MAP = Object.freeze({
  active: { lifecycle: "ACTIVE" }, "in use": { lifecycle: "ACTIVE" }, in_use: { lifecycle: "ACTIVE" },
  "in storage": { lifecycle: "ACTIVE", store: true }, "in store": { lifecycle: "ACTIVE", store: true }, storage: { lifecycle: "ACTIVE", store: true },
  "not installed": { lifecycle: "REGISTERED" }, registered: { lifecycle: "REGISTERED" }, "not commissioned": { lifecycle: "REGISTERED" },
  "under repair": { lifecycle: "ACTIVE", hold: "REPAIR_ASSESSMENT" }, repair: { lifecycle: "ACTIVE", hold: "REPAIR_ASSESSMENT" },
  "on hold": { lifecycle: "ACTIVE", hold: "OTHER" }, hold: { lifecycle: "ACTIVE", hold: "OTHER" },
  retired: { lifecycle: "RETIRED" }, missing: { lifecycle: "ACTIVE", missing: true }, lost: { lifecycle: "LOST", lost: true },
  disposed: { lifecycle: "DISPOSED", disposed: true }, sold: { lifecycle: "DISPOSED", disposed: true }, scrapped: { lifecycle: "DISPOSED", disposed: true },
});

const MESSAGES = Object.freeze({
  ASSET_OPENING_DUPLICATE: "An existing asset may already match this record.",
  ASSET_OPENING_INVALID_DATE: "Enter a valid historical date.",
  ASSET_OPENING_CATEGORY_UNKNOWN: "Match this category to a valid asset category.",
  ASSET_OPENING_LOCATION_UNKNOWN: "Select an existing location or mark it for review.",
  ASSET_OPENING_CUSTODIAN_UNKNOWN: "The selected employee or custodian could not be matched.",
  ASSET_OPENING_VALUE_MISMATCH: "The opening carrying value does not agree with its components.",
  ASSET_OPENING_FINANCE_MISMATCH: "The imported asset totals do not agree with Finance opening balances.",
  ASSET_OPENING_DEPRECIATION_INVALID: "Review the historical depreciation or remaining-life information.",
  ASSET_OPENING_ALREADY_REGISTERED: "This import row has already been registered.",
  ASSET_OPENING_ALREADY_POSTED: "Opening accounting has already been recorded.",
  ASSET_OPENING_PERIOD_LOCKED: "The opening period is locked; request an authorized adjustment.",
  ASSET_OPENING_PERMISSION_DENIED: "You cannot perform this migration action.",
  ASSET_OPENING_VERSION_CONFLICT: "The migration batch changed. Refresh before continuing.",
  ASSET_OPENING_RECOVERY_REQUIRED: "The previous import is being reconciled. Do not import it again yet.",
  ASSET_OPENING_NOT_FOUND: "This migration is not available.",
  ASSET_OPENING_INVALID: "Check the details and try again.",
});
export const OPENING_MESSAGES = MESSAGES;
export const openingError = (status, code, message, details) => {
  const error = new AssetError(status, message ?? MESSAGES[code] ?? "Check the details and try again.", code);
  if (details) error.details = details;
  return error;
};
// A date column as YYYY-MM-DD, whether the driver returns text or a Date (at local midnight).
export const dayOfDb = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v ? String(v).slice(0, 10) : null);
export const requireOpening = (c, key) => { if (!has(c, key)) throw openingError(403, "ASSET_OPENING_PERMISSION_DENIED"); };
