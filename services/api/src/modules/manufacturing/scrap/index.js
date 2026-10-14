// Manufacturing Scrap (0119): the scrap note — issued material in production custody or rejected output, recoverable or irrecoverable, normal
// or abnormal loss; drafts, policy approvals, atomic posting, approved reversal, printing, history, exceptions and reports.
export { SCRAP as SCRAP_PERMISSIONS } from "./scrap-core.js";
export {
  cancelScrap, createScrapDraft, decideScrap, decideScrapCorrection, postScrap, previewScrap, recordMaterialScrapThroughNote, recordScrapPrint, recoverScrap, requestScrapCorrection,
  submitScrap, updateScrapDraft,
} from "./scrap-service.js";
export { checkScrapPosting, getManufacturingScrap, getMoScrapHistory, getScrapExceptions, getScrapReport, getScrappableSources, listManufacturingScraps } from "./scrap-read.js";
