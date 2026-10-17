// The public surface of the Assets desk: every operation re-exported under a name that cannot collide with
// another module's (Quality, Manufacturing and Accounting all have inspections, work orders, calibration and
// fixed-asset functions of their own).
export {
  getAssetSettings, saveAssetSettings, listAssetOptions,
} from "./register.js";
export {
  listAssignments as listAssetAssignments,
} from "./custody.js";
export {
  listMaintenancePlans, saveMaintenancePlan, generateDueMaintenance, listWorkOrders as listAssetWorkOrders, getWorkOrder as getAssetWorkOrder, createWorkOrder as createAssetWorkOrder, startWorkOrder as startAssetWorkOrder, holdWorkOrder as holdAssetWorkOrder, cancelWorkOrder as cancelAssetWorkOrder, addWorkOrderPart as addAssetWorkOrderPart, completeWorkOrder as completeAssetWorkOrder, getRepairHistory as getAssetRepairHistory,
} from "./maintenance.js";
export { listDisposals as listAssetDisposals, requestDisposal as requestAssetDisposal, approveDisposal as approveAssetDisposal, rejectDisposal as rejectAssetDisposal, cancelDisposal as cancelAssetDisposal, completeDisposal as completeAssetDisposal } from "./disposal.js";
export { assetsContext, AssetError } from "./common.js";
