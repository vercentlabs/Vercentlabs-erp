// Assets — Automatic Depreciation Accounting, the rules: permissions, modes, execution states and the errors. Automation prepares and, when
// Finance has opted in, posts depreciation runs; it never calculates depreciation itself and never posts what Finance has not authorized.
import { AssetError, has } from "../common.js";

export const DA = Object.freeze({
  view: "assets.depreciation.automation_view", configure: "assets.depreciation.automation_configure", enable: "assets.depreciation.automation_enable", retry: "assets.depreciation.retry",
});
export const MODE = Object.freeze({ MANUAL: "Manual posting", PREPARE_APPROVE: "Automatic preparation + Finance approval", AUTO_POST: "Automatic posting" });
export const EXECUTION = Object.freeze({ CLAIMED: "Running", WAITING: "Waiting for the period", AWAITING_APPROVAL: "Ready for approval", POSTING: "Posting — being verified", POSTED: "Posted",
  EXCEPTION: "Needs Finance review", FAILED: "Failed", SKIPPED: "Skipped" });
export const RECONCILIATION = Object.freeze({ RECONCILED: "Reconciled", PENDING_POSTING: "Pending posting", PARTIAL_POSTING: "Partly posted", MISMATCH: "Mismatch", RECOVERY_REQUIRED: "Recovery required" });

const MESSAGES = Object.freeze({
  DEPRECIATION_AUTO_POLICY_DISABLED: "Automatic depreciation is disabled for this Company and book.",
  DEPRECIATION_AUTO_PERIOD_NOT_READY: "The accounting period is not ready for posting.",
  DEPRECIATION_AUTO_PERIOD_CLOSED: "The accounting period is closed.",
  DEPRECIATION_AUTO_SCHEDULE_INVALID: "Review the asset's approved depreciation schedule.",
  DEPRECIATION_AUTO_GL_MAPPING_MISSING: "Configure the missing depreciation accounts.",
  DEPRECIATION_AUTO_APPROVAL_REQUIRED: "Finance approval is required before posting.",
  DEPRECIATION_AUTO_ALREADY_POSTED: "Depreciation has already been posted for this period.",
  DEPRECIATION_AUTO_STALE_BASIS: "An asset's approved financial basis has changed. Recalculate the run.",
  DEPRECIATION_AUTO_UNBALANCED_JOURNAL: "The journal does not balance and cannot be posted.",
  DEPRECIATION_AUTO_PARTIAL_POSTING: "Some depreciation entries posted. Review outstanding items.",
  DEPRECIATION_AUTO_FINANCE_UNAVAILABLE: "Finance posting is temporarily unavailable.",
  DEPRECIATION_AUTO_RECONCILIATION_FAILED: "Depreciation and Finance balances do not agree.",
  DEPRECIATION_AUTO_PERMISSION_DENIED: "You are not authorized to perform this accounting action.",
  DEPRECIATION_AUTO_CONCURRENT_RUN: "Another run is processing this Company and period.",
  DEPRECIATION_AUTO_OUTCOME_UNKNOWN: "The previous posting is being verified. It will not be reposted until reconciled.",
  DEPRECIATION_AUTO_CATCH_UP: "This run includes earlier months not yet posted; Finance confirms their treatment before posting.",
  DEPRECIATION_AUTO_NOT_READY: "Automatic posting cannot be enabled until every readiness check passes.",
  DEPRECIATION_AUTO_INVALID: "Check the details and try again.",
});
export const AUTOMATION_MESSAGES = MESSAGES;
export const daError = (status, code, message, details) => {
  const error = new AssetError(status, message ?? MESSAGES[code] ?? "Check the details and try again.", code);
  if (details) error.details = details;
  return error;
};
export const requireDa = (c, key) => { if (!has(c, key)) throw daError(403, "DEPRECIATION_AUTO_PERMISSION_DENIED"); };
export const dayOfDb = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v ? String(v).slice(0, 10) : null);
// Months as YYYY-MM-01; month arithmetic in UTC.
export const monthStart = (day) => `${String(day).slice(0, 7)}-01`;
export const addMonths = (day, n) => { const [y, m] = String(day).split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10); };
export const monthEnd = (day) => { const [y, m] = String(day).split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
export const addDays = (day, n) => new Date(Date.parse(`${String(day).slice(0, 10)}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
