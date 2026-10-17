// Assets — Asset Transfers, the rules: permissions, types, reasons, the transfer and line states, and the errors. A transfer is complete
// only when the movement is verified: requesting a destination never changes an asset's location or custodian.
import { AssetError, has } from "../common.js";

export const TR = Object.freeze({
  view: "assets.transfer.view", create: "assets.transfer.create", submit: "assets.transfer.submit", approve: "assets.transfer.approve", reject: "assets.transfer.reject",
  dispatch: "assets.transfer.dispatch", receive: "assets.transfer.receive", complete: "assets.transfer.complete", cancel: "assets.transfer.cancel",
  reportException: "assets.transfer.report_exception", manageException: "assets.transfer.manage_exception", bulk: "assets.transfer.bulk_manage", history: "assets.transfer.view_history",
  export: "assets.transfer.export",
});
export const seesTransfers = (c) => Object.values(TR).some((k) => has(c, k));
// Acts for any source or destination (otherwise: only for what one manages, holds or receives).
export const manages = (c) => has(c, TR.manageException);
export const seesAll = (c) => manages(c) || has(c, TR.history) || has(c, TR.approve);

export const TYPE = Object.freeze({ LOCATION: "Location transfer", CUSTODY: "Custody transfer", COMBINED: "Location and custody", TEMPORARY: "Temporary movement", RETURN: "Return" });
export const REASON = Object.freeze({ EMPLOYEE_REASSIGNMENT: "Employee reassignment", DEPARTMENT_CHANGE: "Department change", OFFICE_RELOCATION: "Office relocation", INTERNAL_STORAGE: "Internal storage movement",
  CUSTOMER_SITE: "Temporary customer-site deployment", REPAIR: "Repair or service", RETURN_FROM_REPAIR: "Return from repair", REPLACEMENT_RECOVERY: "Replacement or recovery movement",
  DISPOSAL_MOVEMENT: "Authorized disposal-related movement", OTHER: "Other" });
export const STATUS = Object.freeze({ DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", CHANGES_REQUESTED: "Changes requested", APPROVED: "Ready to dispatch", IN_TRANSIT: "In transit",
  PARTIALLY_RECEIVED: "Partly received", RECEIPT_EXCEPTION: "Receipt exception", COMPLETED: "Completed", REJECTED: "Rejected", CANCELLED: "Cancelled", RECOVERY_REQUIRED: "Being checked" });
export const APPROVAL = Object.freeze({ NOT_REQUIRED: "Not required", PENDING: "Pending", APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", REJECTED: "Rejected" });
export const LINE_STATUS = Object.freeze({ PENDING: "Pending", APPROVED: "Approved", DISPATCHED: "In transit", RECEIVED: "Received", COMPLETED: "Completed", RECEIPT_EXCEPTION: "Exception",
  RETURN_IN_PROGRESS: "Returning", CANCELLED: "Cancelled", REJECTED: "Rejected", RETURNED: "Returned to source" });
export const EXCEPTION = Object.freeze({ MISSING: "Missing in transit", DAMAGED: "Damaged on arrival", WRONG_ASSET: "Wrong asset received", DISPUTED: "Disputed receipt", OTHER: "Other" });
export const RESOLUTION = Object.freeze({ RECEIVED: "Received after all", ACCEPTED: "Accepted as received", RETURN_TO_SOURCE: "Returned to the source", LOST_INVESTIGATION: "Lost — under investigation",
  CORRECTED: "Identity corrected and received" });
export const ACTIVE_LINES = Object.freeze(["PENDING", "APPROVED", "DISPATCHED", "RECEIVED", "RECEIPT_EXCEPTION", "RETURN_IN_PROGRESS"]);
export const OPEN_ORDERS = Object.freeze(["DRAFT", "PENDING_APPROVAL", "CHANGES_REQUESTED", "APPROVED", "IN_TRANSIT", "PARTIALLY_RECEIVED", "RECEIPT_EXCEPTION", "RECOVERY_REQUIRED"]);
export const CONDITIONS = Object.freeze(["NEW", "GOOD", "FAIR", "DAMAGED", "UNSERVICEABLE"]);
export const EXTERNAL_KINDS = Object.freeze(["CUSTOMER_SITE", "REPAIR_FACILITY"]);

const MESSAGES = Object.freeze({
  ASSET_TRANSFER_ASSET_UNAVAILABLE: "This asset cannot currently be transferred.",
  ASSET_TRANSFER_ALREADY_ACTIVE: "A transfer is already in progress for this asset.",
  ASSET_TRANSFER_DESTINATION_INVALID: "Select an eligible destination.",
  ASSET_TRANSFER_CUSTODIAN_INVALID: "The receiving custodian is not eligible.",
  ASSET_TRANSFER_APPROVAL_REQUIRED: "This transfer needs approval before dispatch.",
  ASSET_TRANSFER_NOT_DISPATCHED: "Confirm physical dispatch before recording receipt.",
  ASSET_TRANSFER_RECEIPT_MISMATCH: "The received asset does not match the expected identity.",
  ASSET_TRANSFER_ALREADY_RECEIVED: "Receipt has already been recorded.",
  ASSET_TRANSFER_PARTIAL: "Some assets are still awaiting receipt.",
  ASSET_TRANSFER_CANNOT_CANCEL: "This transfer has already been dispatched. Resolve it through return or exception handling.",
  ASSET_TRANSFER_ASSET_DAMAGED: "Record a condition exception before completing normal use.",
  ASSET_TRANSFER_COMPANY_MISMATCH: "This movement crosses Company boundaries and requires a different workflow.",
  ASSET_TRANSFER_PERMISSION_DENIED: "You are not authorized for this transfer action.",
  ASSET_TRANSFER_VERSION_CONFLICT: "The transfer changed. Refresh and review.",
  ASSET_TRANSFER_RECOVERY_REQUIRED: "The previous operation is being checked. Do not submit it again.",
  ASSET_TRANSFER_NOT_FOUND: "This transfer is not available.",
  ASSET_TRANSFER_INVALID: "Check the details and try again.",
});
export const TRANSFER_MESSAGES = MESSAGES;
export const trError = (status, code, message, details) => {
  const error = new AssetError(status, message ?? MESSAGES[code] ?? "Check the details and try again.", code);
  if (details) error.details = details;
  return error;
};
export const requireTr = (c, key) => { if (!has(c, key)) throw trError(403, "ASSET_TRANSFER_PERMISSION_DENIED"); };
export const dayOfDb = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v ? String(v).slice(0, 10) : null);
