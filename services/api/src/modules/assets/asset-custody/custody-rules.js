// Assets — Custodian, the rules. Custody is accountability for safeguarding an asset: one current holder — an employee, a department
// (through its accountable person) or an asset store (through its manager) — apart from the legal owner (the Company, never changed
// here), the registered location (moved only by a transfer) and whoever physically holds it for a repair. Custody changes by handover.
import { AssetError, has } from "../common.js";

export const CUSTODY = Object.freeze({
  view: "assets.view", assign: "assets.custody.assign", reassign: "assets.custody.reassign", return: "assets.custody.return", acknowledge: "assets.custody.acknowledge",
  dispute: "assets.custody.dispute", bulk: "assets.custody.bulk_manage", history: "assets.custody.view_history", exceptions: "assets.custody.manage_exceptions",
  clearance: "assets.custody.view_clearance", export: "assets.custody.export",
});
export const managesCustody = (c) => has(c, CUSTODY.assign) || has(c, CUSTODY.reassign) || has(c, CUSTODY.return);
export const seesCustodyHistory = (c) => has(c, CUSTODY.history) || managesCustody(c);

export const CUSTODIAN_TYPE = Object.freeze({ EMPLOYEE: "Employee", DEPARTMENT: "Department", ASSET_STORE: "Asset store" });
export const HANDOVER_KIND = Object.freeze({ ISSUE: "Issue", REASSIGN: "Reassignment", RETURN: "Return" });
export const HANDOVER_STATUS = Object.freeze({
  PENDING_HANDOVER: "Prepared — not yet handed over", AWAITING_ACKNOWLEDGMENT: "Handed over — awaiting acknowledgment", CONFIRMED: "Confirmed", CANCELLED: "Cancelled", DISPUTED: "Disputed",
});
export const ACKNOWLEDGMENT = Object.freeze({ PENDING: "Awaiting acknowledgment", ACKNOWLEDGED: "Acknowledged", EXCEPTION: "Confirmed by exception", DISPUTED: "Disputed", NOT_REQUIRED: "Not required" });
export const DISPUTE_REASON = Object.freeze({ NOT_RECEIVED: "Asset not received", WRONG_ASSET: "Incorrect asset", WRONG_CONDITION: "Condition not as recorded", MISSING_ACCESSORIES: "Missing accessories", OTHER: "Other" });
export const EXCEPTION_KIND = Object.freeze({ DISPUTED: "Disputed handover", ACKNOWLEDGMENT_WAIVED: "Acknowledgment waived", CANNOT_RETURN: "Cannot be returned", INACTIVE_CUSTODIAN: "Inactive custodian" });
export const CONDITIONS = ["NEW", "GOOD", "FAIR", "DAMAGED", "UNSERVICEABLE"];

const MESSAGES = Object.freeze({
  ASSET_CUSTODY_INVALID_CUSTODIAN: "Select a valid employee, department or Asset Store.",
  ASSET_CUSTODY_EMPLOYEE_INACTIVE: "This employee cannot receive a new asset assignment.",
  ASSET_CUSTODY_ASSET_UNAVAILABLE: "The asset is not currently available for assignment.",
  ASSET_CUSTODY_CONFLICT: "This asset already has a conflicting pending handover.",
  ASSET_CUSTODY_ALREADY_ASSIGNED: "Review the existing custody before assigning again.",
  ASSET_CUSTODY_ACKNOWLEDGMENT_REQUIRED: "The recipient acknowledgment is still pending.",
  ASSET_CUSTODY_WRONG_RECIPIENT: "Only the intended recipient may acknowledge this handover.",
  ASSET_CUSTODY_DISPUTED: "This handover is disputed and needs review.",
  ASSET_CUSTODY_RETURN_NOT_CONFIRMED: "Record actual asset receipt before completing the return.",
  ASSET_CUSTODY_LOCATION_TRANSFER_REQUIRED: "Complete the related Asset Transfer to update the registered location.",
  ASSET_CUSTODY_OFFBOARDING_OPEN: "This employee still has assets requiring clearance.",
  ASSET_CUSTODY_COMPANY_MISMATCH: "The selected destination belongs to another Company.",
  ASSET_CUSTODY_PERMISSION_DENIED: "You cannot perform this custody action.",
  ASSET_CUSTODY_VERSION_CONFLICT: "The asset assignment changed. Refresh and review.",
  ASSET_CUSTODY_OUTCOME_UNKNOWN: "The previous handover is being checked. Do not submit it again.",
  ASSET_CUSTODY_NOT_FOUND: "This handover is not available.",
  ASSET_CUSTODY_INVALID: "Check the details and try again.",
});
export const CUSTODY_MESSAGES = MESSAGES;
export const custodyError = (status, code, message, details) => {
  const error = new AssetError(status, message ?? MESSAGES[code] ?? "Check the details and try again.", code);
  if (details) error.details = details;
  return error;
};
export const requireCustody = (ok) => { if (!ok) throw custodyError(403, "ASSET_CUSTODY_PERMISSION_DENIED"); };
