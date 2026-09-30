// The public surface of the Assets desk: every operation re-exported under a name that cannot collide with
// another module's (Quality, Manufacturing and Accounting all have inspections, work orders, calibration and
// fixed-asset functions of their own).
export {
  getAssetSettings, saveAssetSettings, listAssetCategories as listAssetDeskCategories, saveAssetCategory, listAssetLocations, saveAssetLocation, listAssetRegister, resolveAssetByTag, getAssetTagPayload, getAssetProfile, registerAsset, updateAssetRecord, createAssetFromSource, capitalizeAssetRecord, listAssetOptions, listAssetSourceLines,
} from "./register.js";
export {
  assignAssetToCustodian, returnAsset, listAssignments as listAssetAssignments, listAssetMovements, listAssetTransfers, requestAssetTransfer, approveAssetTransfer,
  rejectAssetTransfer, cancelAssetTransfer, completeAssetTransfer,
} from "./custody.js";
export {
  listDepreciationSchedule, listDepreciationRuns, getDepreciationRun, createDepreciationRun, approveDepreciationRun, postDepreciationRun, reverseDepreciationRun, buildDepreciationLines,
} from "./value.js";
export {
  listMaintenancePlans, saveMaintenancePlan, generateDueMaintenance, listWorkOrders as listAssetWorkOrders, getWorkOrder as getAssetWorkOrder, createWorkOrder as createAssetWorkOrder, startWorkOrder as startAssetWorkOrder, holdWorkOrder as holdAssetWorkOrder, cancelWorkOrder as cancelAssetWorkOrder, addWorkOrderPart as addAssetWorkOrderPart, completeWorkOrder as completeAssetWorkOrder, getRepairHistory as getAssetRepairHistory,
} from "./maintenance.js";
export { listDisposals as listAssetDisposals, requestDisposal as requestAssetDisposal, approveDisposal as approveAssetDisposal, rejectDisposal as rejectAssetDisposal, cancelDisposal as cancelAssetDisposal, completeDisposal as completeAssetDisposal } from "./disposal.js";
export {
  getAssetDesk,
} from "./dashboard.js";
export { assetsContext, AssetError } from "./common.js";
