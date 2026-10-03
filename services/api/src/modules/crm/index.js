// Stable public CRM API boundary. Implementation is owned by the eight canonical capability directories.
export { completeCrmActivity } from "./activities/activity-commands.js";
export { getCrmDashboard, getCrmReport } from "./analytics/analytics-service.js";
export { getMetricDrilldown, getMetricRollup, getPipelineBreakdown, getPipelineDashboard, getPipelineMetrics, getQuotaSummary, getUserQuotas } from "./analytics/pipeline-metrics.js";
export { analyticsFiltersFromSearchParams, normalizeAnalyticsFilters } from "./analytics/opportunity-facts.js";
export { buildForecastRollup, captureForecastPeriodSnapshot, captureScheduledForecastSnapshots, getForecastAccuracy, getForecastSnapshot, getForecastWorkspace, listForecastSubmissionEvents, reviewForecast, setForecastPeriodStatus, submitForecast } from "./analytics/forecast-service.js";
export { COVERAGE_REASSIGN_LIMIT, getSalesCoverage, listUnassignedRecords, reassignCoverage, transferTerritoryCoverage } from "./sales-organization/coverage-service.js";
export { BREAKDOWN_DIMENSIONS, listMetricDefinitions, METRIC_VERSION, PIPELINE_METRICS } from "./analytics/metric-definitions.js";
export { CrmError } from "./data-management/errors.js";
export { archiveCrmRecord, createCrmRecord, runCrmAutomation, updateCrmRecord } from "./data-management/resource-mutation-service.js";
export { moveOpportunityStage, updateOpportunityProbability, restoreOpportunity, listOpportunityProbabilityHistory, getOpportunityPredictiveProbability } from "./pipeline/opportunity-transitions.js";
export { getCrmOptions } from "./data-management/resource-options.js";
export { queueOutboxEvent } from "./data-management/outbox.js";
export { canViewAllCrmRecords, recordScope } from "./data-management/record-policy.js";
export { getCrmRecord, listCrmRecords, snapshotOpportunityBulkJobSelection } from "./data-management/resource-query-service.js";
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

// task-operations.js is exported from this module's index.js, like
// call-operations.js/meeting-operations.js above.
export {
  cancelCrmTask,
  reopenCrmTask,
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

// F028 — runtime custom fields bound to built-in CRM entities, using the
// platform-level custom_field_definitions/custom_field_values tables
// (002_platform_foundation.sql).
export {
  createCustomFieldDefinition,
  getCustomFieldValueHistory,
  getCustomFieldValues,
  listCustomFieldDefinitions,
  setCustomFieldDefinitionActive,
  setCustomFieldValues,
} from "./data-management/custom-field-runtime.js";

// F028 — tag ASSIGNMENT over the tenant.crm_lead_tags junction. Tag
// definitions flow through the generic resource-mutation-service ("tags"
// in resource-registry.js); this puts a defined tag on a record.
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

// Commands, queries and job entry points that first-party consumers (web API
// routes, worker handlers) already used through the package root, plus the
// lead lifecycle/duplicate names this boundary's index.d.ts already declared.
// Package consumers import them from @vercentlabs/api/crm.

// F002/F003/F004/F008 Accounts, Contacts, relationships, lead sources, duplicates, merge, Customer 360 and privacy.
export {
  archiveCrmContact,
  createCrmContact,
  getCrmContactForCaller,
  listCrmContacts,
  reactivateCrmContact,
  updateCrmContact,
} from "./master-data/contact-operations.js";
export {
  addContactAccountRelationship,
  listAccountContactRelationships,
  listContactAccountRelationships,
  removeContactAccountRelationship,
  setPrimaryContactAccountRelationship,
  updateContactAccountRelationship,
} from "./master-data/contact-relationships.js";
export {
  findAccountDuplicates,
  findContactDuplicates,
  projectDuplicateMatchesForCaller,
  recordAccountDuplicateOverride,
} from "./master-data/duplicate-matching.js";
export {
  listDuplicateRules,
  setDuplicateRuleEnabled,
  upsertDuplicateRule,
} from "./master-data/duplicate-rules.js";
export {
  DUPLICATE_FULL_SCAN_JOB_TYPE,
  enqueueDuplicateFullScan,
  getDuplicateFullScanJob,
  getLatestDuplicateFullScan,
  listDuplicateScanMatches,
  processDuplicateFullScanBatch,
} from "./master-data/duplicate-scan.js";
export {
  mergeContactsGoverned,
  previewContactMergeForCaller,
} from "./master-data/merge/record-merge.js";
export {
  executePrivacyRequest,
  previewPrivacyRequest,
} from "./master-data/privacy/privacy-requests.js";
export {
  getPrivacyRetentionDashboard,
  runPrivacyRetention,
  updatePrivacyRetentionPolicy,
} from "./master-data/privacy/privacy-retention.js";


// F009-F012 Opportunity bulk jobs, contact roles, stage ageing, snapshots, forecasts and stage migration.
export {
  addOpportunityContactRole,
  listContactOpportunityRoles,
  listOpportunityContactRoles,
  removeOpportunityContactRole,
  setPrimaryOpportunityContactRole,
  updateOpportunityContactRole,
} from "./pipeline/opportunity-contacts.js";
export {
  bulkUpdateOpportunities,
  enqueueOpportunityBulkUpdateJob,
  getOpportunityBulkJob,
  resolveOpportunityBulkExecutionContext,
} from "./pipeline/opportunity-operations.js";
export {
  capturePredictiveForecast,
  getForecastCalibration,
} from "./pipeline/opportunity-revenue-intelligence.js";
export {
  capturePipelineSnapshots,
  listPipelineSnapshots,
} from "./pipeline/pipeline-snapshots.js";
export {
  listOpportunityPipelineStageTotals,
  listOpportunityStageAges,
  listOpportunityStageBottlenecks,
  listStageSlaPolicies,
  upsertStageSlaPolicy,
} from "./pipeline/stage-aging.js";
export {
  deactivateSalesStageWithMigration,
  OPPORTUNITY_STAGE_MIGRATION_JOB_TYPE,
  processOpportunityStageMigrationBatch,
} from "./pipeline/stage-migration.js";

// F014/F018 Meetings, public booking links, calendar sync and email history.
export {
  getCrmEmailHistory,
  getCrmEmailThread,
} from "./activities/communications/email-service.js";
export {
  fetchProviderCalendarDelta,
  pushProviderCalendarEvent,
} from "./activities/communications/provider-integrations.js";
export {
  bookMeeting,
  cancelMeetingBooking,
  getMeetingAvailability,
  rescheduleMeetingBooking,
} from "./activities/meetings/meeting-booking.js";
export {
  claimCalendarSyncAccounts,
  completeCalendarSync,
  failCalendarSync,
  prepareMeetingCalendarPush,
  recordMeetingCalendarPushResult,
} from "./activities/meetings/meeting-calendar.js";
export {
  assertPublicDate,
  getPublicMeetingBookingView,
  getPublicMeetingLinkView,
  getPublicRescheduleAvailability,
  publicMeetingContext,
  resolvePublicMeetingBooking,
  resolvePublicMeetingLink,
} from "./activities/public-meetings.js";

// F021/F029 Lead import/export jobs and mobile offline sync.
export {
  applyOfflineBatch,
} from "./data-management/offline-sync.js";
// Leads: the record, lifecycle, assignment, qualification, duplicates,
// conversion, activities, sources, import/export, dashboard and report.
export * from "./leads/index.js";
export * from "./accounts/index.js";
