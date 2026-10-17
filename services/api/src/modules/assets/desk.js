// The public surface of the Assets desk: every operation re-exported under a name that cannot collide with
// another module's (Quality, Manufacturing and Accounting all have inspections, work orders, calibration and
// fixed-asset functions of their own).
export {
  getAssetSettings, saveAssetSettings, listAssetOptions,
} from "./register.js";
export {
  listAssignments as listAssetAssignments,
} from "./custody.js";
export { assetsContext, AssetError } from "./common.js";
