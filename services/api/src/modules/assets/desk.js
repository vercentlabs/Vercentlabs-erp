// The public surface of the Assets desk: every operation re-exported under a name that cannot collide with
// another module's (Quality, Manufacturing and Accounting all have inspections, work orders, calibration and
// fixed-asset functions of their own). The original thin `index.js` is left as it was.
export {
  getAssetSettings, saveAssetSettings, listAssetCategories as listAssetDeskCategories, saveAssetCategory, listAssetLocations, saveAssetLocation, listAssetRegister,
  resolveAssetByTag, getAssetTagPayload, getAssetProfile, registerAsset, updateAssetRecord, addAssetDocument, removeAssetDocument, createAssetFromSource,
  capitalizeAssetRecord, listAssetOptions, listAssetSourceLines,
} from "./register.js";
export {
  assignAssetToCustodian, returnAsset, listAssignments as listAssetAssignments, listAssetMovements, listAssetTransfers, requestAssetTransfer, approveAssetTransfer,
  rejectAssetTransfer, cancelAssetTransfer, completeAssetTransfer,
} from "./custody.js";
export {
  listDepreciationSchedule, recordAssetUsage, listDepreciationRuns, getDepreciationRun, createDepreciationRun, approveDepreciationRun, postDepreciationRun,
  reverseDepreciationRun, listValueAdjustments, requestValueAdjustment, approveValueAdjustment, rejectValueAdjustment, cancelValueAdjustment, buildDepreciationLines,
} from "./value.js";
export {
  listMaintenancePlans, saveMaintenancePlan, generateDueMaintenance, listWorkOrders as listAssetWorkOrders, getWorkOrder as getAssetWorkOrder,
  createWorkOrder as createAssetWorkOrder, startWorkOrder as startAssetWorkOrder, holdWorkOrder as holdAssetWorkOrder, cancelWorkOrder as cancelAssetWorkOrder,
  addWorkOrderPart as addAssetWorkOrderPart, completeWorkOrder as completeAssetWorkOrder, getRepairHistory as getAssetRepairHistory, listDowntime as listAssetDowntime,
  recordDowntime as recordAssetDowntime, endDowntime as endAssetDowntime, listWarranties as listAssetWarranties, saveWarranty as saveAssetWarranty,
  listWarrantyClaims as listAssetWarrantyClaims, createWarrantyClaim as createAssetWarrantyClaim, updateWarrantyClaim as updateAssetWarrantyClaim,
  listInspections as listAssetInspections, recordInspection as recordAssetInspection, listCalibrations as listAssetCalibrations, recordCalibration as recordAssetCalibration,
} from "./maintenance.js";
export {
  listVerificationCampaigns as listAssetVerificationCampaigns, getVerificationCampaign as getAssetVerificationCampaign, createVerificationCampaign as createAssetVerificationCampaign,
  startVerificationCampaign as startAssetVerificationCampaign, scanVerificationAsset as scanAssetForVerification, resolveVerificationDiscrepancy as resolveAssetDiscrepancy,
  closeVerificationCampaign as closeAssetVerificationCampaign, cancelVerificationCampaign as cancelAssetVerificationCampaign,
} from "./control.js";
export { listDisposals as listAssetDisposals, requestDisposal as requestAssetDisposal, approveDisposal as approveAssetDisposal, rejectDisposal as rejectAssetDisposal, cancelDisposal as cancelAssetDisposal, completeDisposal as completeAssetDisposal } from "./disposal.js";
export { getAssetDesk, getAssetReport } from "./reports.js";
export { assetsContext, AssetError } from "./common.js";
