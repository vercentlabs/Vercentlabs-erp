// Assets — Automatic Depreciation Accounting: a Company- and book-scoped orchestration over the depreciation runs — a versioned automation
// policy (manual, automatic preparation with Finance approval, or Finance-enabled automatic posting), durable executions claimed once per
// book and month, idempotent posting through Finance, verification of interrupted postings, journal preview, health and reconciliation.
export { AUTOMATION_MESSAGES as DEPRECIATION_AUTOMATION_MESSAGES, DA as DEPRECIATION_AUTOMATION_PERMISSIONS } from "./da-rules.js";
export {
  configureDepreciationAutomation, disableAutomaticDepreciationPosting, enableAutomaticDepreciationPosting, retryDepreciationExecution, runDepreciationAutomation, triggerDepreciationAutomation,
  validateAutomationReadiness,
} from "./da-commands.js";
export {
  AUTOMATION_REPORTS as DEPRECIATION_AUTOMATION_REPORTS, getDepreciationAutomation, getDepreciationAutomationAudit, getDepreciationAutomationReport, getDepreciationExecution, getDepreciationJournalPreview,
  listDepreciationExecutions,
} from "./da-read.js";
