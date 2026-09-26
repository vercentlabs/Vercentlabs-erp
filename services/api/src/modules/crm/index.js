// Stable public CRM API boundary. Implementation is owned by the eight canonical capability directories.
export { completeCrmActivity } from "./seller-activity-and-follow-up-workspace/activity-commands.js";
export { getCrmDashboard, getCrmReport } from "./pipeline-analytics-and-forecasting/analytics-service.js";
export { findCrmDuplicates } from "./prospect-and-relationship-master-data/duplicate-search.js";
export { CrmError } from "./crm-data-operations-and-customization/errors.js";
export { assignLeadOwner } from "./lead-lifecycle-qualification-and-prioritization/lead-assignment.js";
export { captureCrmLead } from "./prospect-and-relationship-master-data/lead-capture.js";
export { convertCrmLead, mergeCrmLead } from "./crm-conversion-and-sales-handoff/lead-conversion.js";
export { archiveCrmRecord, createCrmRecord, runCrmAutomation, updateCrmRecord } from "./crm-data-operations-and-customization/resource-mutation-service.js";
export { moveOpportunityStage, updateOpportunityProbability, restoreOpportunity, listOpportunityProbabilityHistory, getOpportunityPredictiveProbability } from "./opportunity-and-pipeline-governance/opportunity-transitions.js";
export { getCrmOptions } from "./crm-data-operations-and-customization/resource-options.js";
export { leadOutboxChangedFields, queueOutboxEvent } from "./crm-data-operations-and-customization/outbox.js";
export { canViewAllCrmRecords, recordScope } from "./crm-data-operations-and-customization/record-policy.js";
export { getCrmRecord, listCrmRecords, snapshotLeadBulkJobSelection, snapshotOpportunityBulkJobSelection } from "./crm-data-operations-and-customization/resource-query-service.js";
export { isCrmResource, resources } from "./crm-data-operations-and-customization/resource-registry.js";

export {
  createSalesStage,
  getSalesStage,
  listSalesStageHistory,
  listSalesStagePipelines,
  listSalesStages,
  reorderSalesStages,
  setSalesStageActive,
  updateSalesStage,
} from "./opportunity-and-pipeline-governance/sales-stage-operations.js";

export {
  cancelCrmCall,
  completeCrmCall,
  createCrmCall,
  getCrmCall,
  listCrmCallEvents,
  listCrmCalls,
  startCrmCall,
  updateCrmCall,
} from "./seller-activity-and-follow-up-workspace/call-operations.js";

export {
  cancelCrmMeeting,
  completeCrmMeeting,
  createCrmMeeting,
  getCrmMeeting,
  listCrmMeetingEvents,
  listCrmMeetings,
  startCrmMeeting,
  updateCrmMeeting,
} from "./seller-activity-and-follow-up-workspace/meeting-operations.js";

// Prompt 6 integrity note: task-operations.js was previously exported only
// from the top-level package index (services/api/src/index.js), not from
// this module's own index.js — an architectural inconsistency versus
// call-operations.js/meeting-operations.js above, fixed here rather than
// left standing while other CRM-CAP-004 work lands in this same pass.
export {
  cancelCrmTask,
  claimCrmTask,
  completeCrmTask,
  createCrmTask,
  getCrmTask,
  listCrmTaskHistory,
  listCrmTasks,
  listMyTaskTeams,
  listTeamMembers,
  releaseCrmTask,
  startCrmTask,
  updateCrmTask,
  taskOverdueSql,
  computeNextTaskOccurrence,
  generateNextTaskOccurrence,
  addTaskDependency,
  removeTaskDependency,
  listTaskDependencies,
} from "./seller-activity-and-follow-up-workspace/task-operations.js";

export {
  archiveCrmNote,
  createCrmNote,
  getCrmNote,
  listCrmNoteVersions,
  listCrmNotes,
  updateCrmNote,
} from "./seller-activity-and-follow-up-workspace/notes/notes-operations.js";

export { resolveCrmEntityAccess } from "./seller-activity-and-follow-up-workspace/timeline/timeline.js";

export {
  communicationVisibilitySql,
  projectCrmCommunication,
  projectCrmCommunications,
  resolveCallerParticipantCommunicationIds,
  resolveCommunicationParticipants,
} from "./seller-activity-and-follow-up-workspace/communications/communication-projection.js";

export {
  createCrmAttachment,
  crmAttachmentStorageEntityType,
  deleteCrmAttachment,
  getCrmAttachmentContent,
  listCrmAttachments,
  listCrmAttachmentVersions,
} from "./seller-activity-and-follow-up-workspace/attachments/attachments-operations.js";

// F028 (Prompt 3 Stage A) — runtime custom fields bound to built-in CRM
// entities, using the platform-level custom_field_definitions/
// custom_field_values tables (002_platform_foundation.sql), which had
// zero service layer anywhere in the codebase before this — confirmed by
// direct search, not assumed missing the way sales-stage-operations.js
// turned out to already be reachable via this same file.
export {
  createCustomFieldDefinition,
  getCustomFieldValueHistory,
  getCustomFieldValues,
  listCustomFieldDefinitions,
  setCustomFieldDefinitionActive,
  setCustomFieldValues,
} from "./crm-data-operations-and-customization/custom-field-runtime.js";

// F028 Tranche C (Prompt 3 Stage A) — tag ASSIGNMENT over the existing
// tenant.crm_lead_tags junction. Tag definitions already flow through
// the generic resource-mutation-service ("tags" in resource-registry.js);
// this closes the gap that tag definitions alone did not let anyone
// actually put a tag on a record.
export {
  assignRecordTag,
  listRecordTags,
  removeRecordTag,
} from "./crm-data-operations-and-customization/tag-assignment.js";

export {
  acknowledgeReminder,
  cancelCrmFollowUp,
  claimDueReminders,
  completeCrmFollowUp,
  createCrmFollowUp,
  createRemindersForActivity,
  cancelPendingRemindersForActivity,
  escalateOverdueFollowUps,
  getCrmFollowUp,
  listCrmFollowUpHistory,
  listCrmFollowUps,
  listRemindersForActivity,
  markReminderOutcome,
  resetStuckDispatchingReminders,
  snoozeCrmFollowUp,
  updateCrmFollowUp,
} from "./seller-activity-and-follow-up-workspace/follow-ups/follow-up-operations.js";

export { getManagerForUser } from "./seller-activity-and-follow-up-workspace/shared/notify.js";

export {
  getCrmTimelinePage as getCrmRecordTimelinePage,
  getCrmTimelinePageBySource,
} from "./seller-activity-and-follow-up-workspace/timeline/timeline.js";

// F020 territory coverage: validation and the lead → territory match used by
// territory-mode assignment rules (and the "check a lead" tool on the screen).
export {
  matchLeadTerritory,
  normalizeTerritoryCoverage,
  TERRITORY_TYPES,
} from "./sales-organization-and-coverage/territory-coverage.js";
