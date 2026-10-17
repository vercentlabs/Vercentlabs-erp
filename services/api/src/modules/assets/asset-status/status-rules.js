// Assets — Asset Status, the rules. Four separate dimensions: the lifecycle (one state machine, moved only by explicit actions), the
// availability (derived from custody, transfers and maintenance — never a free field), the physical condition (observations with their
// own history) and Finance's classification (read back, never owned here). A Hold returns the asset to the state it came from; a missing
// report is an incident until someone authorized confirms the loss.
import { AssetError, has } from "../common.js";

export const STATUS = Object.freeze({
  view: "assets.view", register: "assets.create", commission: "assets.activate", placeHold: "assets.status.place_hold", releaseHold: "assets.status.release_hold",
  retire: "assets.retire_or_dispose", reportMissing: "assets.status.report_missing", confirmLost: "assets.status.confirm_lost", recover: "assets.status.recover",
  reinstate: "assets.status.reinstate", condition: "assets.status.condition_update", history: "assets.status.view_history", bulk: "assets.status.bulk_action",
});
export const seesStatusHistory = (c) => has(c, STATUS.history) || has(c, STATUS.placeHold) || has(c, STATUS.confirmLost);

export const HOLD_REASON = Object.freeze({
  SAFETY_CONCERN: "Safety concern", INSPECTION_PENDING: "Inspection pending", DAMAGE_INVESTIGATION: "Damage investigation", COMPLIANCE_RESTRICTION: "Compliance restriction",
  OWNERSHIP_VERIFICATION: "Ownership verification", REPAIR_ASSESSMENT: "Repair assessment", OTHER: "Other",
});
export const EFFECTIVE_AVAILABILITY = Object.freeze({
  NOT_AVAILABLE: "Not available", AVAILABLE: "Available", ASSIGNED: "Assigned", IN_TRANSFER: "In transfer", UNDER_MAINTENANCE: "Under maintenance",
});
export const CONDITION_LABEL = Object.freeze({ NEW: "New", GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged", UNSERVICEABLE: "Unserviceable", UNKNOWN: "Unknown (not yet verified)" });
export const INCIDENT_STATUS = Object.freeze({ OPEN: "Under investigation", CONFIRMED_LOST: "Confirmed lost", RECOVERED: "Recovered", CLOSED_FOUND: "Closed — found" });
export const ACTION_LABEL = Object.freeze({
  CREATE: "Created", register: "Registered", activate: "Commissioned", hold: "Placed on hold", release: "Hold released", retire: "Retired", "confirm-lost": "Confirmed lost",
  recover: "Recovered", reinstate: "Reinstated", IMPORT: "Imported", opening: "Opening migration", WORKFLOW_UPDATE: "Changed by a workflow", DISPOSAL: "Disposed",
});

const MESSAGES = Object.freeze({
  ASSET_STATUS_INVALID_TRANSITION: "This status change is not allowed.",
  ASSET_STATUS_NOT_READY: "Complete the required asset details first.",
  ASSET_STATUS_ALREADY_ACTIVE: "This asset is already active.",
  ASSET_STATUS_HOLD_REQUIRED: "Enter a reason for placing the asset on Hold.",
  ASSET_STATUS_ACTIVE_HOLD_EXISTS: "This asset is already on Hold.",
  ASSET_STATUS_HOLD_UNRESOLVED: "Resolve the Hold before releasing the asset.",
  ASSET_STATUS_TRANSFER_PENDING: "Review the active transfer before changing status.",
  ASSET_STATUS_MAINTENANCE_ACTIVE: "This asset is under maintenance.",
  ASSET_STATUS_CUSTODY_REVIEW_REQUIRED: "Review the current assignment or custody.",
  ASSET_STATUS_LOSS_REVIEW_REQUIRED: "The missing-asset investigation requires authorization.",
  ASSET_STATUS_DISPOSAL_PENDING: "Finish the disposal workflow before marking this asset Disposed.",
  ASSET_STATUS_FINANCE_REVIEW_REQUIRED: "Finance must review the accounting impact.",
  ASSET_STATUS_PERMISSION_DENIED: "You cannot perform this action.",
  ASSET_STATUS_VERSION_CONFLICT: "This asset changed. Refresh and review.",
  ASSET_STATUS_OUTCOME_UNKNOWN: "The previous action is being checked. Do not repeat it yet.",
});
export const STATUS_MESSAGES = MESSAGES;
export const statusError = (status, code, message, details) => {
  const error = new AssetError(status, message ?? MESSAGES[code] ?? "Check the details and try again.", code);
  if (details) error.details = details;
  return error;
};
export const requireStatus = (c, key) => { if (!has(c, key)) throw statusError(403, "ASSET_STATUS_PERMISSION_DENIED"); };
