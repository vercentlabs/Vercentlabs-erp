// Assets — Asset Movement History, the rules: permissions, the event vocabulary, certainty, ordering, and the errors. Movement History is
// a read model of facts the owning workflows committed; nothing here changes where an asset is or who holds it.
import { AssetError, has } from "../common.js";

export const MV = Object.freeze({
  view: "assets.movement.view", history: "assets.movement.view_history", evidence: "assets.movement.view_evidence", custody: "assets.movement.view_custody",
  audit: "assets.movement.view_audit", export: "assets.movement.export", reconcile: "assets.movement.reconcile", correct: "assets.movement.request_correction",
});
export const seesMovements = (c) => Object.values(MV).some((k) => has(c, k));
// Company-wide history: every asset's timeline and the directory. Without it a person sees the assets they hold or have held.
export const companyWide = (c) => has(c, MV.history) || has(c, MV.audit) || has(c, MV.reconcile);

export const EVENT = Object.freeze({
  OPENING_BASELINE: "Opening baseline", INITIAL_PLACEMENT: "Registered location", INITIAL_CUSTODY: "First custodian", ASSIGNMENT_ISSUED: "Issued to custodian",
  ASSIGNMENT_RETURNED: "Returned", CUSTODY_CHANGED: "Custody handed over", HANDOVER_ACKNOWLEDGED: "Receipt acknowledged", HANDOVER_DISPUTED: "Receipt disputed",
  HANDOVER_CONFIRMED_BY_EXCEPTION: "Confirmed by exception", LOCATION_CHANGED: "Location updated", TRANSFER_REQUESTED: "Transfer requested", TRANSFER_APPROVED: "Transfer approved",
  TRANSFER_DISPATCHED: "Dispatched", TRANSFER_RECEIVED: "Received", TRANSFER_COMPLETED: "Transfer completed", TRANSFER_CANCELLED: "Transfer cancelled",
  MOVEMENT_EXCEPTION: "Movement exception", TEMPORARY_MOVEMENT: "Temporary movement", RETURN_FROM_TEMPORARY_MOVEMENT: "Back from temporary movement",
  LOCATION_OBSERVED: "Location observed", LOCATION_DISCREPANCY: "Location discrepancy", MISSING_REPORTED: "Reported missing", DISPOSED: "Disposed", MOVEMENT_CORRECTED: "Correction",
});
export const EVENT_TYPES = Object.freeze(Object.keys(EVENT));
export const CERTAINTY = Object.freeze({ CONFIRMED: "Confirmed", PENDING: "Pending", OBSERVED: "Observed", DISPUTED: "Disputed", CORRECTED: "Corrected" });
export const GROUP = Object.freeze({ OPENING: "Opening", REGISTRATION: "Registration", TRANSFER: "Asset transfer", ASSIGNMENT: "Asset assignment", HANDOVER: "Custody handover",
  OBSERVATION: "Observation", INCIDENT: "Missing incident", MAINTENANCE: "Maintenance", DISPOSAL: "Disposal", CORRECTION: "Correction" });
export const CUSTODIAN = Object.freeze({ EMPLOYEE: "Employee", DEPARTMENT: "Department", ASSET_STORE: "Asset store" });

// Within one moment, the order the business steps happen in — requested before approved before dispatched before received — so the same
// timestamp never shuffles a timeline; then the record time, then the stable event id.
export const RANK_SQL = `CASE e.event_type WHEN 'OPENING_BASELINE' THEN 1 WHEN 'INITIAL_PLACEMENT' THEN 2 WHEN 'INITIAL_CUSTODY' THEN 3 WHEN 'TRANSFER_REQUESTED' THEN 10
  WHEN 'TRANSFER_APPROVED' THEN 11 WHEN 'TRANSFER_DISPATCHED' THEN 12 WHEN 'TEMPORARY_MOVEMENT' THEN 12 WHEN 'MOVEMENT_EXCEPTION' THEN 13 WHEN 'TRANSFER_RECEIVED' THEN 14
  WHEN 'RETURN_FROM_TEMPORARY_MOVEMENT' THEN 14 WHEN 'LOCATION_CHANGED' THEN 15 WHEN 'TRANSFER_COMPLETED' THEN 16 WHEN 'ASSIGNMENT_ISSUED' THEN 20 WHEN 'CUSTODY_CHANGED' THEN 20
  WHEN 'ASSIGNMENT_RETURNED' THEN 20 WHEN 'HANDOVER_ACKNOWLEDGED' THEN 21 WHEN 'HANDOVER_DISPUTED' THEN 21 WHEN 'HANDOVER_CONFIRMED_BY_EXCEPTION' THEN 21
  WHEN 'TRANSFER_CANCELLED' THEN 30 ELSE 40 END`;
export const ORDER_SQL = `e.effective_at, ${RANK_SQL}, e.recorded_at, e.id`;

const MESSAGES = Object.freeze({
  ASSET_MOVEMENT_NOT_FOUND: "The requested movement could not be found.",
  ASSET_MOVEMENT_SOURCE_UNAVAILABLE: "The original transaction is temporarily unavailable.",
  ASSET_MOVEMENT_ACCESS_DENIED: "You cannot view this movement.",
  ASSET_MOVEMENT_CORRECTION_SOURCE_REQUIRED: "Open the original transaction to request this correction.",
  ASSET_MOVEMENT_CONFLICT: "The movement history conflicts with the asset's current records.",
  ASSET_MOVEMENT_HISTORY_INCOMPLETE: "Some historical records are not available.",
  ASSET_MOVEMENT_PROJECTION_DELAYED: "Recent changes are still being synchronized.",
  ASSET_MOVEMENT_REBUILD_REQUIRED: "Movement history needs reconciliation.",
  ASSET_MOVEMENT_EXPORT_FAILED: "The history export could not be completed.",
  ASSET_MOVEMENT_COMPANY_MISMATCH: "This movement belongs to another Company.",
  ASSET_MOVEMENT_INVALID: "Check the details and try again.",
});
export const MOVEMENT_MESSAGES = MESSAGES;
export const mvError = (status, code, message, details) => {
  const error = new AssetError(status, message ?? MESSAGES[code] ?? "Check the details and try again.", code);
  if (details) error.details = details;
  return error;
};
export const requireMv = (c, key) => { if (!has(c, key)) throw mvError(403, "ASSET_MOVEMENT_ACCESS_DENIED"); };
