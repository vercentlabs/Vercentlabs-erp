// Material Consumption Variance (0122): expected against actual material use per order line on a chosen basis, tolerances (company, item group,
// item), exceptions with investigation, review bound to the evaluated figures and resolution, BOM review requests, completion checks, reports.
export { BAND_LABEL as VARIANCE_BAND_LABEL, BASES as VARIANCE_BASES, REASONS as VARIANCE_REASONS, VAR as VARIANCE_PERMISSIONS } from "./variance-core.js";
export {
  closeBomReviewRequest, decideVarianceException, openVarianceException, recommendProductionHold, removeVarianceTolerance, requestAdditionalMaterial, requestBomReview,
  resolveVarianceException, setVarianceTolerance, snapshotFinalVariances, submitVarianceException, updateVarianceException, varianceCompletionBlockers,
} from "./variance-service.js";
export {
  VARIANCE_REPORTS, getMaterialVarianceReport, getMoMaterialVarianceLine, getMoMaterialVariances, getMoVarianceHistory, getVarianceException, getVarianceReviewQueue, listBomReviewRequests,
  listVarianceExceptions, listVarianceGroups, listVarianceTolerances,
} from "./variance-read.js";
