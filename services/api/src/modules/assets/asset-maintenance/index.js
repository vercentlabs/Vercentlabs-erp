// Assets — Asset Maintenance: reported problems (with an immediate safety restriction when the asset may be unsafe) and their triage, Work
// Orders from approval to an independent verification and the return to service, preventive service plans that generate one Work Order per
// due occurrence, costs linked once from the authoritative Inventory, Procurement and Finance documents, downtime, history and reports.
export { MAINTENANCE_MESSAGES, MT as MAINTENANCE_PERMISSIONS } from "./mt-rules.js";
export {
  approveMaintenanceWorkOrder, assignMaintenanceExecutor, cancelMaintenanceWorkOrder, completeMaintenanceWork, createMaintenanceRequest, createMaintenanceWorkOrder, createPreventiveMaintenancePlan,
  generateDueMaintenanceOccurrences, linkMaintenanceCapitalImprovement, linkMaintenancePartsConsumption, linkMaintenanceTransfer, linkMaintenanceVendorCost, notifyMaintenanceDue, recordMaintenanceWarranty,
  recordMaintenanceWork, reopenMaintenanceWorkOrder, respondToMaintenanceRequest, returnAssetToService, scheduleMaintenanceWorkOrder, setMaintenanceWaiting, startMaintenanceWork, submitMaintenanceWorkOrder,
  triageMaintenanceRequest, unlinkMaintenanceCost, updatePreventiveMaintenancePlan, verifyMaintenanceRepair,
} from "./mt-commands.js";
export {
  MAINTENANCE_REPORTS, exportMaintenance, getAssetDowntime, getAssetMaintenancePanel, getMaintenanceAudit, getMaintenanceCostSummary, getMaintenanceDue, getMaintenanceExceptions, getMaintenanceOverview,
  getMaintenanceOptions, getMaintenancePlan, getMaintenanceReport, getMaintenanceRequest, getMaintenanceWorkOrder, listMaintenancePlans, listMaintenanceRequests, listMaintenanceWorkOrders, reconcileMaintenanceSources,
} from "./mt-read.js";

// The scheduled job: due preventive occurrences become Work Orders (once each), then overdue work is notified (once per Work Order and day).
export async function runMaintenanceSchedule(client, c, input = {}) {
  const { generateDueMaintenanceOccurrences, notifyMaintenanceDue } = await import("./mt-commands.js");
  const generated = await generateDueMaintenanceOccurrences(client, c, input);
  const overdue = await notifyMaintenanceDue(client, c, input);
  return { ...generated, ...overdue };
}
