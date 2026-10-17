// Assets — Asset Assignment, the rules: permissions, request states, recipient kinds, and the errors. An assignment request is a decision to
// allocate equipment; the Custodian workflow stays the only record of who is accountable, and it changes only at the physical handover.
import { AssetError, has } from "../common.js";

export const ASG = Object.freeze({
  view: "assets.assignment.view", request: "assets.assignment.request", approve: "assets.assignment.approve", issue: "assets.assignment.issue", return: "assets.assignment.return",
  extend: "assets.assignment.extend", bulk: "assets.assignment.bulk", manage: "assets.assignment.manage_exception", history: "assets.assignment.view_history", export: "assets.assignment.export",
});
export const seesAssignments = (c) => Object.values(ASG).some((k) => has(c, k));
// The asset team: acts for anyone (requests for others, sees every request).
export const assetTeam = (c) => has(c, ASG.manage) || has(c, ASG.approve) || has(c, ASG.issue) || has(c, ASG.history);
export const STATUS = Object.freeze({ DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", CHANGES_REQUESTED: "Changes requested", READY_TO_ISSUE: "Ready to issue", IN_TRANSFER: "On its way (transfer)",
  ISSUED_AWAITING_ACKNOWLEDGMENT: "Issued — awaiting acknowledgment", FULFILLED: "Assigned", REJECTED: "Rejected", CANCELLED: "Cancelled", RECOVERY_REQUIRED: "Being checked" });
export const RECIPIENT = Object.freeze({ EMPLOYEE: "Employee", DEPARTMENT: "Department", ASSET_STORE: "Asset store" });
export const ACK = Object.freeze({ PENDING: "Awaiting acknowledgment", ACKNOWLEDGED: "Acknowledged", DISPUTED: "Disputed", EXCEPTION: "Confirmed by exception" });
export const OPEN = Object.freeze(["DRAFT", "PENDING_APPROVAL", "CHANGES_REQUESTED", "READY_TO_ISSUE", "IN_TRANSFER"]);
export const CONDITIONS = Object.freeze(["NEW", "GOOD", "FAIR", "DAMAGED", "UNSERVICEABLE"]);

const MESSAGES = Object.freeze({
  ASSET_ASSIGNMENT_ASSET_UNAVAILABLE: "This asset is not available for assignment.",
  ASSET_ASSIGNMENT_RECIPIENT_INVALID: "Select a valid employee, department or store.",
  ASSET_ASSIGNMENT_EMPLOYEE_INACTIVE: "This employee cannot receive a new asset.",
  ASSET_ASSIGNMENT_ALREADY_RESERVED: "Another assignment or transfer is already pending for this asset.",
  ASSET_ASSIGNMENT_APPROVAL_REQUIRED: "This issue requires approval.",
  ASSET_ASSIGNMENT_ISSUE_NOT_CONFIRMED: "Confirm physical issue before completing the assignment.",
  ASSET_ASSIGNMENT_RECEIPT_PENDING: "The recipient's acknowledgment is pending.",
  ASSET_ASSIGNMENT_RECEIPT_DISPUTED: "This receipt has been disputed and needs review.",
  ASSET_ASSIGNMENT_RETURN_OVERDUE: "This asset's expected return date has passed.",
  ASSET_ASSIGNMENT_RETURN_NOT_RECEIVED: "Confirm physical receipt before completing the return.",
  ASSET_ASSIGNMENT_TRANSFER_REQUIRED: "Use an authorized transfer to change the registered location.",
  ASSET_ASSIGNMENT_COMPANY_MISMATCH: "The selected Asset and recipient belong to different Companies.",
  ASSET_ASSIGNMENT_PERMISSION_DENIED: "You cannot perform this assignment action.",
  ASSET_ASSIGNMENT_VERSION_CONFLICT: "This assignment changed. Refresh and review.",
  ASSET_ASSIGNMENT_RECOVERY_REQUIRED: "The previous operation is being checked. Do not submit it again.",
  ASSET_ASSIGNMENT_NOT_FOUND: "This assignment is not available.",
  ASSET_ASSIGNMENT_INVALID: "Check the details and try again.",
});
export const ASSIGNMENT_MESSAGES = MESSAGES;
export const asgError = (status, code, message, details) => {
  const error = new AssetError(status, message ?? MESSAGES[code] ?? "Check the details and try again.", code);
  if (details) error.details = details;
  return error;
};
export const requireAsg = (c, key) => { if (!has(c, key)) throw asgError(403, "ASSET_ASSIGNMENT_PERMISSION_DENIED"); };
export const dayOfDb = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v ? String(v).slice(0, 10) : null);
