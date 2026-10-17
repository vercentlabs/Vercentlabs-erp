// Assets — Asset Disposal: one Company-scoped disposal workflow (one asset or many) coordinating approval by policy, the physical exit or
// confirmed loss, the Sales Invoice of a sale and Finance-controlled derecognition, completed per asset — disposed only once its exit and its
// derecognition are verified, derecognized exactly once, recovered (never re-posted) when an outcome is unknown, and corrected only by reversal.
export { DISPOSAL_MESSAGES, DX as DISPOSAL_PERMISSIONS } from "./dx-rules.js";
export {
  amendAssetDisposal, approveAssetDisposal, cancelAssetDisposal, completeAssetDisposal, confirmDisposalHandover, correctAssetDisposal, createAssetDisposalCase, linkDisposalSaleInvoice, postAssetDerecognition,
  prepareAssetDerecognition, reconcileAssetDisposals, recoverAssetDisposal, rejectAssetDisposal, resolveDisposalException, submitAssetDisposal, unlinkDisposalSaleInvoice, updateAssetDisposalCase,
  validateDisposalEligibility,
} from "./dx-commands.js";
export {
  DISPOSAL_REPORTS, exportAssetDisposals, getAssetDisposal, getAssetDisposalPanel, getDisposalAudit, getDisposalFinancialPreview, getDisposalOptions, getDisposalOverview, getDisposalReport, listAssetDisposals,
  listDisposalExceptions,
} from "./dx-read.js";
export {
  MILESTONES as DISPOSAL_EXECUTION_MILESTONES, SALE_MESSAGES as ASSET_SALE_MESSAGES, SCRAP_METHODS as ASSET_SCRAP_METHODS, allocateAssetSaleProceeds, configureAssetSale, configureAssetScrap, createDisposalSaleInvoice,
  dispatchDisposalAsset, getSaleScrapExecutionQueue, recordScrapEvidence,
} from "./dx-execution.js";
export {
  FINANCIAL_STATE as DISPOSAL_FINANCIAL_STATES, GAIN_LOSS_REPORTS as DISPOSAL_GAIN_LOSS_REPORTS, GL_CODES as DISPOSAL_GL_MESSAGES, adjustDisposalResult, getDisposalFinancialSnapshots, getGainLossRows as getDisposalGainLossRows,
  linkDisposalCost, recalculateDisposalPreview, recordDisposalInsuranceClaim, unlinkDisposalCost,
} from "./dx-financial.js";
