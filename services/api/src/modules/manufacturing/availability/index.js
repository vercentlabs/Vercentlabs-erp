// Manufacturing Material Availability (0114): requirements, coverage, shortages and feasible output over Inventory's own stock.
export {
  MATERIAL as MATERIAL_PERMISSIONS, getMaterialAvailability, getMaterialReport, listMaterialShortages, previewBomAvailability, previewMaterialReservation, requestMaterialShortages,
  validateMaterialIssueReadiness,
} from "./material-availability.js";
