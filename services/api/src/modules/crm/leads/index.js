// The Leads domain. Routes and other modules import from here; each lead
// operation is one function (createLead, assignLead, qualifyLead, convertLead,
// …) taking (client, context, …) and running inside the caller's transaction.
export * from "./constants.js";
export { canViewAllLeadRecords, canViewSensitiveLeadContent, leadCan, leadCapabilities, leadScopeSql, projectLeadForContext } from "./access.js";
export {
  LEAD_VIEWS, archiveLead, bulkChangeLeadStage, changeLeadStage, createLead, getLead, listLeads, restoreLead, updateLead,
} from "./records.js";
export {
  assertEligibleLeadAssignee, assignLead, assignLeadToSelf, assignLeadToTeam, bulkAssignLeads, countUserActiveLeads, getLeadAssignmentWorkload,
  listLeadAssignmentHistory, listLeadAssignmentOptions, reassignLead, transferUserLeads, unassignLead,
} from "./assignment.js";
export {
  deleteLeadAssignmentRule, evaluateLeadAssignment, getLeadAssignmentSettings, listLeadAssignmentRules, reorderLeadAssignmentRules,
  runLeadAssignmentRules, saveLeadAssignmentRule, saveLeadAssignmentSettings, setLeadAssignmentRuleActive,
} from "./assignment-rules.js";
export { bulkDisqualifyLeads, disqualifyLead, qualifyLead, reopenLead, saveLeadQualification } from "./qualification.js";
export { findLeadDuplicates } from "./duplicates.js";
export { mergeLeads } from "./merge.js";
export { convertLead, previewLeadConversion } from "./conversion.js";
export { addLeadActivity, listLeadActivities, scheduleLeadFollowUp } from "./activities.js";
export { listLeadHistory } from "./history.js";
export { createLeadSource, ensureDefaultLeadSources, listLeadSources, updateLeadSource } from "./sources.js";
export { LEAD_IMPORT_FIELDS, analyzeLeadImport, buildLeadImportTemplate, exportLeads, importLeads } from "./import-export.js";
export { getLeadDashboard, getLeadsByStatusReport } from "./dashboard.js";
export { captureCrmLead, resolvePublicCaptureOrganization } from "./capture.js";
export { getLeadOptions } from "./options.js";
