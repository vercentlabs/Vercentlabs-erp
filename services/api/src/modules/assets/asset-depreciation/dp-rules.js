// Assets — Straight-Line Depreciation, the rules: permissions, states, exclusion reasons and the errors. The Assets subsystem calculates an
// auditable schedule; Finance owns the posted depreciation, the accumulated depreciation and the carrying value.
import { AssetError, has } from "../common.js";

export const DP = Object.freeze({
  view: "assets.depreciation.view", financials: "assets.depreciation.view_financials", policy: "assets.depreciation.manage_policy", assign: "assets.depreciation.assign_policy",
  generate: "assets.depreciation.generate", prepare: "assets.depreciation.prepare_run", review: "assets.depreciation.review", approve: "assets.depreciation.approve",
  post: "assets.depreciation.post", revise: "assets.depreciation.revise_estimate", correct: "assets.depreciation.correct", reconcile: "assets.depreciation.reconcile",
  export: "assets.depreciation.export", audit: "assets.depreciation.view_audit",
});
// Finance's own right to post a journal: an Assets permission alone never posts to the ledger.
export const FINANCE_POST = "accounting.journal.post";
export const seesDepreciation = (c) => Object.values(DP).some((k) => has(c, k));

export const RUN_STATUS = Object.freeze({ DRAFT: "Draft", CALCULATING: "Calculating", READY_FOR_REVIEW: "Ready for review", NEEDS_CORRECTION: "Needs correction", APPROVED: "Approved",
  POSTING: "Posting", POSTED: "Posted", PARTIALLY_POSTED: "Partly posted", RECOVERY_REQUIRED: "Being verified", CANCELLED: "Cancelled" });
export const BASIS_SOURCE = Object.freeze({ CAPITALIZATION: "Capitalization", OPENING: "Opening balance", REVISION: "Estimate revision", ADJUSTMENT: "Cost adjustment", MIGRATED: "Earlier schedule", ASSIGNED: "Assigned policy" });
export const CONVENTION = Object.freeze({ DAILY: "Daily proration", FULL_MONTH: "Full month" });
// Why an asset is not in a run (or not for the full amount). Blocking reasons stop the run until corrected; the others are reported.
export const EXCLUSION = Object.freeze({
  POLICY_MISSING: { label: "No approved depreciation basis", blocking: false },
  COST_UNCONFIRMED: { label: "Finance has not confirmed the cost", blocking: false },
  CWIP_PENDING: { label: "Not yet ready for ordinary depreciation", blocking: false },
  NOT_COMMENCED: { label: "Depreciation has not commenced", blocking: false },
  FULLY_DEPRECIATED: { label: "Fully depreciated", blocking: false },
  DISPOSED: { label: "Disposed before this month", blocking: false },
  RETIRED_REVIEW: { label: "Retired — Finance decides the treatment", blocking: false },
  LOST_REVIEW: { label: "Confirmed lost — Finance reviews write-off", blocking: false },
  BASIS_PROPOSED: { label: "A basis change is waiting for approval", blocking: false },
  SOURCE_CHANGED: { label: "The approved basis no longer matches the asset's cost or balances", blocking: true },
  GL_MAPPING_MISSING: { label: "Depreciation accounts are not configured", blocking: true },
});

const MESSAGES = Object.freeze({
  ASSET_DEPRECIATION_NOT_ELIGIBLE: "This asset is not eligible for depreciation.",
  ASSET_DEPRECIATION_COST_UNCONFIRMED: "Finance has not confirmed the asset cost.",
  ASSET_DEPRECIATION_POLICY_MISSING: "Select an approved depreciation policy.",
  ASSET_DEPRECIATION_USEFUL_LIFE_INVALID: "Enter a valid useful life.",
  ASSET_DEPRECIATION_RESIDUAL_INVALID: "Review the residual value.",
  ASSET_DEPRECIATION_DATE_INVALID: "Review the depreciation commencement date.",
  ASSET_DEPRECIATION_CWIP_PENDING: "This asset is not yet ready for ordinary depreciation.",
  ASSET_DEPRECIATION_BOOK_INVALID: "Select an authorized accounting book.",
  ASSET_DEPRECIATION_GL_MAPPING_MISSING: "Configure the required Finance accounts.",
  ASSET_DEPRECIATION_PERIOD_CLOSED: "This accounting period is closed.",
  ASSET_DEPRECIATION_ALREADY_POSTED: "Depreciation has already been posted for this asset and period.",
  ASSET_DEPRECIATION_SOURCE_CHANGED: "The approved accounting basis changed. Recalculate the draft.",
  ASSET_DEPRECIATION_DISPOSAL_CONFLICT: "Review the disposal and depreciation dates.",
  ASSET_DEPRECIATION_RECONCILIATION_FAILED: "The depreciation records do not agree with Finance.",
  ASSET_DEPRECIATION_PERMISSION_DENIED: "You cannot perform this action.",
  ASSET_DEPRECIATION_OUTCOME_UNKNOWN: "The posting is being verified. Do not submit it again.",
  ASSET_DEPRECIATION_NOT_FOUND: "This depreciation record is not available.",
  ASSET_DEPRECIATION_INVALID: "Check the details and try again.",
  ASSET_DEPRECIATION_PENDING: "Post the depreciation due up to the disposal date before completing this disposal.",
  ASSET_DEPRECIATION_CATCH_UP_UNACKNOWLEDGED: "This run includes earlier months; confirm Finance's treatment of the catch-up.",
  DEPRECIATION_SCHEDULE_COST_PENDING: "Finance has not confirmed the asset's cost.",
  DEPRECIATION_SCHEDULE_POLICY_MISSING: "Select an approved depreciation policy.",
  DEPRECIATION_SCHEDULE_INVALID_LIFE: "Review the useful life.",
  DEPRECIATION_SCHEDULE_INVALID_RESIDUAL: "Review the residual value.",
  DEPRECIATION_SCHEDULE_DATE_INVALID: "Check the depreciation start date.",
  DEPRECIATION_SCHEDULE_ASSET_NOT_READY: "This asset is not yet ready for depreciation.",
  DEPRECIATION_SCHEDULE_ALREADY_CURRENT: "A current schedule already exists. Review or revise it.",
  DEPRECIATION_SCHEDULE_SOURCE_CHANGED: "Financial inputs have changed. Generate a new preview.",
  DEPRECIATION_SCHEDULE_PERIOD_LOCKED: "The selected accounting period is locked.",
  DEPRECIATION_SCHEDULE_POSTING_MISMATCH: "The scheduled and posted depreciation do not agree.",
  DEPRECIATION_SCHEDULE_VERSION_CONFLICT: "The schedule changed. Refresh and review.",
});
export const LIFECYCLE = Object.freeze({ DRAFT: "Draft — awaiting approval", VALIDATION_FAILED: "Validation failed", CURRENT: "Current", SUPERSEDED: "Superseded", COMPLETED: "Completed", TERMINATED: "Terminated" });
// Each month of a schedule, derived from the run lines and Finance's journals — never stored as an editable figure.
export const PERIOD_STATUS = Object.freeze({ PLANNED: "Planned", DUE: "Due", IN_POSTING: "In posting", POSTED: "Posted", ADJUSTED: "Adjusted", SKIPPED: "Skipped", EXCEPTION: "Exception" });
export const DEPRECIATION_MESSAGES = MESSAGES;
export const dpError = (status, code, message, details) => {
  const error = new AssetError(status, message ?? MESSAGES[code] ?? "Check the details and try again.", code);
  if (details) error.details = details;
  return error;
};
export const requireDp = (c, key) => { if (!has(c, key)) throw dpError(403, "ASSET_DEPRECIATION_PERMISSION_DENIED"); };
export const dayOfDb = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}` : v ? String(v).slice(0, 10) : null);
export const money = (v) => (v === null || v === undefined ? null : String(v));
