// Quality — Nonconformance (MVP 36): the NCR workflow (open → review → action → verification → resolved → closed), affected items, actions,
// dependencies, evidence and the reads.
export { NC as QUALITY_NC_PERMISSIONS, QualityNcError } from "./nc-rules.js";
export {
  addNonconformanceAction, addNonconformanceLink, assignNonconformance, cancelNonconformance, cancelNonconformanceAction, closeNonconformance, completeNonconformanceAction,
  completeNonconformanceLink, createNonconformance, recordNonconformanceContainment, recordNonconformanceInvestigation, reopenNonconformance, requireNonconformanceAction,
  startNonconformanceReview, submitNonconformanceForVerification, updateNonconformance, verifyNonconformance,
} from "./nc-commands.js";
export {
  NC_REPORTS, exportNonconformanceReport, getNonconformance, getNonconformanceCounts, getNonconformanceDashboard, getNonconformanceReport, listNonconformanceOptions, listNonconformances,
} from "./nc-read.js";
export { listNonconformanceEvidence, prepareNonconformanceEvidenceUpload, readNonconformanceEvidence, removeNonconformanceEvidence, uploadNonconformanceEvidence } from "./nc-files.js";
