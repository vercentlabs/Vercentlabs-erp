// Assets — Straight-Line Depreciation: one Finance-controlled depreciation engine — versioned policies for the financial-reporting book,
// each asset's approved basis, deterministic schedule versions, monthly runs posted once through Finance's journal (recovered when the
// outcome is unknown), estimate revisions that keep posted history, and reconciliation with the General Ledger.
export { DP as ASSET_DEPRECIATION_PERMISSIONS, DEPRECIATION_MESSAGES as ASSET_DEPRECIATION_MESSAGES, LIFECYCLE as DEPRECIATION_SCHEDULE_LIFECYCLE, PERIOD_STATUS as DEPRECIATION_PERIOD_STATUS } from "./dp-rules.js";
export { calculateStraightLineSchedule, chargeThroughDisposal } from "./dp-engine.js";
export {
  approveDepreciationSchedule, onAssetDisposed, previewDepreciationSchedule, rebuildDepreciationSchedules,
  approveDepreciationBasis, approveDepreciationRun, assertDepreciationSettled, bulkGenerateDepreciationSchedules, cancelDepreciationRun, createDepreciationPolicy, deactivateDepreciationPolicy, generateDepreciationSchedule, onAssetCapitalized, onCapitalizationReversed, onCostAdjusted, onOpeningApproved, postDepreciationRun, prepareDepreciationRun, previewDepreciationRevision, proposeDepreciationBasis, recalculateDepreciationRun, recoverDepreciationPosting, rejectDepreciationBasis, resolveDepreciationPolicy, reviseDepreciationEstimate, reviseDepreciationPolicy,
} from "./dp-commands.js";
export { DEPRECIATION_REPORTS as ASSET_DEPRECIATION_REPORTS, getDueDepreciationLines, listDepreciationSchedules, plannedVsPosted, exportDepreciation, getAssetDepreciation, getDepreciationExceptions, getDepreciationHistory, getDepreciationOverview, getDepreciationReport, getDepreciationRun, listDepreciableAssets, listDepreciationPolicies, listDepreciationRuns, listEstimateChanges, reconcileDepreciation } from "./dp-read.js";
