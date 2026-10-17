// Quality — Quality Control Points (MVP 30): when quality checks apply, which standard they use, and the fail-safe quality gate.
export * from "./qcp-commands.js";
export * from "./qcp-read.js";
export {
  activateDueQcps, assertQualityRelease, createReceiptObligations, decideObligationConflict, matchControlPoints, noteObligationInspection, planReceiptLineQuality, previewQualityControlPoints,
  reconcileReversedReceipt, reevaluateObligation, releaseAllowance, requestManualInspection, specificationForControlPoint,
} from "./qcp-engine.js";
export { QCP as QUALITY_QCP, QualityQcpError, TRIGGERS as QUALITY_QCP_TRIGGERS } from "./qcp-rules.js";
