// Manufacturing Material Consumption (0116): consumption notes — drafts, BOM suggestion and usage variance, approval, posting against the
// exact issued stock, corrections, printing, custody reconciliation and reports.
export { CONSUMPTION as MATERIAL_CONSUMPTION_PERMISSIONS } from "./consumption-core.js";
export {
  cancelMaterialConsumption, createMaterialConsumptionDraft, decideConsumptionVarianceApproval, postMaterialConsumption, previewMaterialConsumption, recordMaterialConsumptionPrint,
  recoverMaterialConsumption, requestConsumptionVarianceApproval, reverseMaterialConsumption, updateMaterialConsumptionDraft,
} from "./consumption-service.js";
export {
  checkMaterialConsumptionPosting, getConsumableMoMaterials, getConsumptionReconciliation, getMaterialConsumption, getMaterialConsumptionReport, getMoConsumptionHistory,
  getUnreconciledConsumption, listMaterialConsumptions, suggestBomConsumption,
} from "./consumption-read.js";
