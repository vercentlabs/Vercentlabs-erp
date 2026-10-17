// Assets — Asset Maintenance, the rules: permissions, request and Work Order states, types, outcomes and the errors. Every maintenance event
// has a traceable request, authorized work, a recorded outcome and a controlled return-to-service decision.
import { AssetError, has } from "../common.js";

export const MT = Object.freeze({
  view: "assets.maintenance.view", request: "assets.maintenance.request", triage: "assets.maintenance.triage", create: "assets.maintenance.create_work_order",
  assign: "assets.maintenance.assign", approve: "assets.maintenance.approve", schedule: "assets.maintenance.schedule", execute: "assets.maintenance.execute",
  parts: "assets.maintenance.record_parts", cost: "assets.maintenance.view_cost", complete: "assets.maintenance.complete", verify: "assets.maintenance.verify",
  release: "assets.maintenance.release", plans: "assets.maintenance.manage_plans", cancel: "assets.maintenance.cancel", reopen: "assets.maintenance.reopen",
  export: "assets.maintenance.export", audit: "assets.maintenance.view_audit",
});
export const seesMaintenance = (c) => Object.values(MT).some((k) => has(c, k));
// The maintenance team sees every request and Work Order; anyone else sees what they reported, hold, or are assigned.
export const maintenanceTeam = (c) => has(c, MT.triage) || has(c, MT.create) || has(c, MT.approve) || has(c, MT.audit) || has(c, MT.cost);

export const TYPES = ["CORRECTIVE", "PREVENTIVE", "INSPECTION", "EMERGENCY"];
export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];
export const CONDITIONS = ["NEW", "GOOD", "FAIR", "DAMAGED", "UNSERVICEABLE"];
export const TYPE_LABEL = Object.freeze({ CORRECTIVE: "Corrective", PREVENTIVE: "Preventive", INSPECTION: "Inspection", EMERGENCY: "Emergency" });
export const REQUEST_STATUS = Object.freeze({ OPEN: "Open", NEEDS_INFORMATION: "Needs information", ACCEPTED: "Accepted", REJECTED: "Rejected", CLOSED: "Closed" });
export const WO_STATUS = Object.freeze({ DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", APPROVED: "Approved", SCHEDULED: "Scheduled", IN_PROGRESS: "In progress",
  WAITING_FOR_PARTS: "Waiting for parts", WAITING_FOR_VENDOR: "Waiting for vendor", WORK_COMPLETED: "Work completed", PENDING_VERIFICATION: "Pending verification",
  CLOSED: "Closed", CANCELLED: "Cancelled", RECOVERY_REQUIRED: "Being checked" });
export const OUTCOME = Object.freeze({ REPAIRED: "Repaired", REPAIRED_WITH_LIMITATIONS: "Repaired with limitations", UNREPAIRABLE: "Unrepairable", REQUIRES_FURTHER_WORK: "Requires further work",
  CANCELLED_NO_WORK: "Cancelled — no work", DUPLICATE_REQUEST: "Duplicate request" });
export const OPEN_WO = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "IN_PROGRESS", "WAITING_FOR_PARTS", "WAITING_FOR_VENDOR", "WORK_COMPLETED", "PENDING_VERIFICATION", "RECOVERY_REQUIRED"];
export const WORKING = ["IN_PROGRESS", "WAITING_FOR_PARTS", "WAITING_FOR_VENDOR"];

const MESSAGES = Object.freeze({
  ASSET_MAINTENANCE_ASSET_INVALID: "Select a valid asset.",
  ASSET_MAINTENANCE_ASSET_DISPOSED: "Maintenance cannot be started for a disposed asset.",
  ASSET_MAINTENANCE_DUPLICATE_REQUEST: "A similar issue is already open for this asset.",
  ASSET_MAINTENANCE_TECHNICIAN_INVALID: "Select an eligible technician.",
  ASSET_MAINTENANCE_APPROVAL_REQUIRED: "This work requires authorization.",
  ASSET_MAINTENANCE_PART_UNAVAILABLE: "The required spare part is unavailable.",
  ASSET_MAINTENANCE_STOCK_ISSUE_PENDING: "Inventory has not confirmed part consumption.",
  ASSET_MAINTENANCE_VENDOR_REFERENCE_INVALID: "Select a valid supplier or service document.",
  ASSET_MAINTENANCE_VERIFICATION_REQUIRED: "Complete the required repair checks before closing.",
  ASSET_MAINTENANCE_RESTRICTION_ACTIVE: "Another restriction is still preventing normal use.",
  ASSET_MAINTENANCE_WARRANTY_REVIEW: "Check whether this repair may be covered by warranty.",
  ASSET_MAINTENANCE_PERIOD_COST_UNAVAILABLE: "Actual accounting cost has not yet been confirmed.",
  ASSET_MAINTENANCE_PERMISSION_DENIED: "You cannot perform this maintenance action.",
  ASSET_MAINTENANCE_VERSION_CONFLICT: "The Work Order changed. Refresh and review.",
  ASSET_MAINTENANCE_RECOVERY_REQUIRED: "The previous operation is being verified. Do not submit it again.",
  ASSET_MAINTENANCE_NOT_FOUND: "This maintenance record is not available.",
  ASSET_MAINTENANCE_INVALID: "Check the details and try again.",
});
export const MAINTENANCE_MESSAGES = MESSAGES;
export const mtError = (status, code, message, details) => {
  const error = new AssetError(status, message ?? MESSAGES[code] ?? "Check the details and try again.", code);
  if (details) error.details = details;
  return error;
};
export const requireMt = (c, key) => { if (!has(c, key)) throw mtError(403, "ASSET_MAINTENANCE_PERMISSION_DENIED"); };
export const dayOfDb = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v ? String(v).slice(0, 10) : null);
export const addInterval = (day, type, n) => {
  const [y, m, d] = String(day).slice(0, 10).split("-").map(Number);
  if (type === "DAYS") return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  // Months: the same day of the month, or the month's last day when shorter (31 Jan + 1 month = 28/29 Feb).
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};
// The union of downtime intervals (ms): overlapping restrictions never count the same hours twice.
export function unionMs(intervals) {
  const sorted = intervals.filter((x) => x.end > x.start).sort((a, b) => a.start - b.start);
  let total = 0; let curStart = null; let curEnd = null;
  for (const x of sorted) {
    if (curEnd === null || x.start > curEnd) { if (curEnd !== null) total += curEnd - curStart; curStart = x.start; curEnd = x.end; }
    else if (x.end > curEnd) curEnd = x.end;
  }
  if (curEnd !== null) total += curEnd - curStart;
  return total;
}
