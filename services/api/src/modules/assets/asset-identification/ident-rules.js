// Assets — Asset Identification, the rules. An asset has one permanent identity — its UUID and its Company-scoped AST-… code, both made
// by the backend, never changed or reused — and separate external identifiers: the manufacturer's serial, the Company's asset tag and a
// historical code from an earlier register. Identifiers are matched in a normalized form (the same rule as the database's
// tenant.asset_identifier_normalize) and a placeholder such as N/A is never an identifier.
import { AssetError, has } from "../common.js";

export const IDENT = Object.freeze({
  view: "assets.view", create: "assets.create", editSerial: "assets.identification.edit_serial", editTag: "assets.identification.edit_tag", import: "assets.identification.import",
  printLabel: "assets.identification.print_label", bulkPrint: "assets.identification.bulk_print", history: "assets.identification.view_history",
  resolveDuplicate: "assets.identification.resolve_duplicate", export: "assets.identification.export",
});
export const mayPrint = (c) => has(c, IDENT.printLabel) || has(c, IDENT.bulkPrint);

// Trim, Unicode NFKC, collapse inner whitespace, upper case; hyphens and leading zeros are kept. A placeholder normalizes to null.
const PLACEHOLDERS = new Set(["N/A", "NA", "N.A.", "NONE", "NIL", "NULL", "UNKNOWN", "TBD", "TBA", "NOT AVAILABLE", "NO SERIAL", "XXX", "?"]);
export function normalizeIdentifier(value) {
  if (value === null || value === undefined) return null;
  const n = String(value).normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
  if (!n || /^[-_./ 0]*$/.test(n) || PLACEHOLDERS.has(n)) return null;
  return n;
}
// Something typed that is not an identifier (blank is fine — "no serial").
export const isPlaceholder = (value) => String(value ?? "").trim() !== "" && normalizeIdentifier(value) === null;

export const IDENTIFIER_TYPE = Object.freeze({ SERIAL: "Serial number", TAG: "Asset tag", LEGACY_CODE: "Previous asset code", PREVIOUS_TAG: "Previous tag", PREVIOUS_SERIAL: "Previous serial" });
export const CHANGE_KIND = Object.freeze({ CORRECTION: "Corrected", REPLACEMENT: "Replaced", REMOVAL: "Removed", IMPORT: "Imported", DUPLICATE_EXCEPTION: "Duplicate accepted" });

const MESSAGES = Object.freeze({
  ASSET_CODE_GENERATION_FAILED: "The Asset Code could not be generated. Please try again.",
  ASSET_SERIAL_REQUIRED: "Enter the manufacturer's serial number.",
  ASSET_SERIAL_DUPLICATE: "An asset with this serial number may already exist.",
  ASSET_TAG_DUPLICATE: "This Asset Tag is already assigned.",
  ASSET_IDENTIFIER_INVALID: "Enter a valid identifier.",
  ASSET_IDENTIFIER_AMBIGUOUS: "Several assets match this identifier. Please select one.",
  ASSET_IDENTIFIER_NOT_FOUND: "No authorized asset matches this identifier.",
  ASSET_IDENTIFIER_EDIT_DENIED: "You cannot change this identifier.",
  ASSET_CODE_IMMUTABLE: "The system Asset Code cannot be changed.",
  ASSET_LABEL_NOT_AVAILABLE: "This asset's label could not be generated.",
  ASSET_SOURCE_QUANTITY_EXCEEDED: "The selected purchase quantity has already been registered.",
  ASSET_BULK_REGISTRATION_PARTIAL: "Some assets were registered. Review the remaining rows.",
  ASSET_COMPANY_MISMATCH: "The selected asset belongs to another Company.",
  ASSET_VERSION_CONFLICT: "This asset changed. Refresh and review.",
  ASSET_REGISTRATION_OUTCOME_UNKNOWN: "Your registration is being checked. Do not submit it again.",
  ASSET_STATE_INVALID: "This action is not available in the asset's current state.",
});
export const IDENT_MESSAGES = MESSAGES;
export const identError = (status, code, message, details) => {
  const error = new AssetError(status, message ?? MESSAGES[code] ?? "Check the details and try again.", code);
  if (details) error.details = details;
  return error;
};
