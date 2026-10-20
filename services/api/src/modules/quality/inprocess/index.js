// Quality — In-Process Inspection (MVP 32): the production adapter of the shared inspection engine — triggers and checkpoints, the gates
// Manufacturing enforces, manual requests, rework confirmation, production status, dashboard, exceptions and reports.
export { FP as QUALITY_FINAL_PERMISSIONS, IP as QUALITY_INPROCESS_PERMISSIONS } from "../incoming/in-rules.js";
export { FINAL_TRIGGER, IP_TRIGGER, assertProductionAcceptance, assertProductionProgress, createProductionObligations, planProductionQuality, productionAllowance, reconcileProductionCorrection } from "./ip-engine.js";
export { confirmInProcessRework, requestFinalInspection, requestInProcessInspection } from "./ip-commands.js";
export { INPROCESS_REPORTS, exportInProcessReport, getInProcessDashboard, getInProcessReport, listInProcessExceptions, listInProcessOptions } from "./ip-read.js";
export { FINAL_REPORTS, exportFinalReport, getFinalDashboard, getFinalReport, listFinalOptions } from "./final-read.js";
