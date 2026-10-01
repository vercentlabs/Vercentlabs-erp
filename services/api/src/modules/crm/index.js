// Stable public CRM API boundary. Implementation is owned by the eight canonical capability directories.
export { completeCrmActivity } from "./activities/activity-commands.js";
export { getCrmDashboard, getCrmReport } from "./analytics/analytics-service.js";
export { getMetricDrilldown, getMetricRollup, getPipelineBreakdown, getPipelineDashboard, getPipelineMetrics, getQuotaSummary, getUserQuotas } from "./analytics/pipeline-metrics.js";
export { analyticsFiltersFromSearchParams, normalizeAnalyticsFilters } from "./analytics/opportunity-facts.js";
export { buildForecastRollup, captureForecastPeriodSnapshot, captureScheduledForecastSnapshots, getForecastAccuracy, getForecastSnapshot, getForecastWorkspace, listForecastSubmissionEvents, reviewForecast, setForecastPeriodStatus, submitForecast } from "./analytics/forecast-service.js";
export { COVERAGE_REASSIGN_LIMIT, getSalesCoverage, listUnassignedRecords, reassignCoverage, transferTerritoryCoverage } from "./sales-organization/coverage-service.js";
export { BREAKDOWN_DIMENSIONS, listMetricDefinitions, METRIC_VERSION, PIPELINE_METRICS } from "./analytics/metric-definitions.js";
export { findCrmDuplicates } from "./master-data/duplicate-search.js";
export { CrmError } from "./data-management/errors.js";
export { assignLeadOwner } from "./lead-management/lead-assignment.js";
export { captureCrmLead, resolvePublicCaptureOrganization } from "./master-data/lead-capture.js";
export { convertCrmLead, mergeCrmLead } from "./conversions/lead-conversion.js";
export { archiveCrmRecord, createCrmRecord, runCrmAutomation, updateCrmRecord } from "./data-management/resource-mutation-service.js";
export { moveOpportunityStage, updateOpportunityProbability, restoreOpportunity, listOpportunityProbabilityHistory, getOpportunityPredictiveProbability } from "./pipeline/opportunity-transitions.js";
export { getCrmOptions } from "./data-management/resource-options.js";
export { leadOutboxChangedFields, queueOutboxEvent } from "./data-management/outbox.js";
export { canViewAllCrmRecords, recordScope } from "./data-management/record-policy.js";
export { getCrmRecord, listCrmRecords, snapshotLeadBulkJobSelection, snapshotOpportunityBulkJobSelection } from "./data-management/resource-query-service.js";
export { isCrmResource, resources } from "./data-management/resource-registry.js";

export {
  createSalesStage,
  getSalesStage,
  listSalesStageHistory,
  listSalesStagePipelines,
  listSalesStages,
  reorderSalesStages,
  setSalesStageActive,
  updateSalesStage,
} from "./pipeline/sales-stage-operations.js";

export {
  cancelCrmCall,
  completeCrmCall,
  createCrmCall,
  getCrmCall,
  listCrmCallEvents,
  listCrmCalls,
  startCrmCall,
  updateCrmCall,
} from "./activities/call-operations.js";

export {
  cancelCrmMeeting,
  completeCrmMeeting,
  createCrmMeeting,
  getCrmMeeting,
  listCrmMeetingEvents,
  listCrmMeetings,
  startCrmMeeting,
  updateCrmMeeting,
} from "./activities/meeting-operations.js";

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
  computeNextTaskOccurrence,
  generateNextTaskOccurrence,
  addTaskDependency,
  removeTaskDependency,
  listTaskDependencies,
} from "./activities/task-operations.js";

export {
  archiveCrmNote,
  createCrmNote,
  getCrmNote,
  listCrmNoteVersions,
  listCrmNotes,
  updateCrmNote,
} from "./activities/notes/notes-operations.js";

export { taskOverdueSql } from "./data-management/activity-query-rules.js";

export { resolveCrmEntityAccess } from "./data-management/entity-access.js";

export {
  communicationVisibilitySql,
  projectCrmCommunication,
  projectCrmCommunications,
  resolveCallerParticipantCommunicationIds,
} from "./data-management/communication-access.js";
export { resolveCommunicationParticipants } from "./activities/communications/communication-projection.js";

export {
  createCrmAttachment,
  crmAttachmentStorageEntityType,
  deleteCrmAttachment,
  getCrmAttachmentContent,
  listCrmAttachments,
  listCrmAttachmentVersions,
} from "./activities/attachments/attachments-operations.js";

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
} from "./data-management/custom-field-runtime.js";

// F028 Tranche C (Prompt 3 Stage A) — tag ASSIGNMENT over the existing
// tenant.crm_lead_tags junction. Tag definitions already flow through
// the generic resource-mutation-service ("tags" in resource-registry.js);
// this closes the gap that tag definitions alone did not let anyone
// actually put a tag on a record.
export {
  assignRecordTag,
  listRecordTags,
  removeRecordTag,
} from "./data-management/tag-assignment.js";

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
} from "./activities/follow-ups/follow-up-operations.js";

export { getManagerForUser } from "./activities/shared/notify.js";

export {
  getCrmTimelinePage as getCrmRecordTimelinePage,
  getCrmTimelinePageBySource,
} from "./activities/timeline/timeline.js";

// F020 territory coverage: validation and the lead → territory match used by
// territory-mode assignment rules (and the "check a lead" tool on the screen).
export {
  matchLeadTerritory,
  normalizeTerritoryCoverage,
  TERRITORY_TYPES,
} from "./sales-organization/territory-coverage.js";
