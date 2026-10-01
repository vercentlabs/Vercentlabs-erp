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

// Commands, queries and job entry points that first-party consumers (web API
// routes, worker handlers) already used through the package root, plus the
// lead lifecycle/duplicate names this boundary's index.d.ts already declared.
// Package consumers import them from @vercentlabs/api/crm.

// F002/F003/F004/F008 Accounts, Contacts, relationships, lead sources, duplicates, merge, Customer 360 and privacy.
export {
  archiveCrmAccount,
  createCrmAccount,
  getCrmAccountForCaller,
  listCrmAccounts,
  updateCrmAccount,
} from "./master-data/account-operations.js";
export {
  getAccountHierarchy,
  setAccountParent,
} from "./master-data/accounts/account-hierarchy.js";
export {
  getCustomer360ForCaller,
} from "./master-data/accounts/customer-360.js";
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
  queueLeadEnrichment,
  reviewLeadEnrichment,
} from "./master-data/lead-acquisition.js";
export {
  getLeadAttributionTimeline,
} from "./master-data/lead-attribution.js";
export {
  dismissLeadDuplicateMatch,
  evaluateLeadDuplicateRisk,
  LeadDuplicateError,
} from "./master-data/lead-duplicates.js";
export {
  createCrmLeadSource,
  listCrmLeadSources,
  setCrmLeadSourceActive,
  updateCrmLeadSource,
} from "./master-data/lead-source-operations.js";
export {
  mergeAccountsGoverned,
  mergeContactsGoverned,
  previewAccountMergeForCaller,
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

// F005/F006/F007/F027 Lead assignment, qualification, lifecycle stages, bulk jobs, intelligence and scoring.
export {
  archiveLeadAssignmentPolicy,
  listLeadAssignmentPolicies,
  saveLeadAssignmentPolicy,
  setLeadAssignmentPolicyStatus,
} from "./lead-management/assignment/assignment-engine.js";
export {
  clearLeadAssigneeAvailability,
  getLeadAssignmentFallback,
  listLeadAssigneeAvailability,
  setLeadAssigneeAvailability,
  setLeadAssignmentFallback,
} from "./lead-management/assignment/availability.js";
export {
  explainLeadAssignmentCandidates,
} from "./lead-management/assignment/eligibility.js";
export {
  addBusinessMinutes,
  claimDueNurtureQueueItems,
  openLeadSlaCase,
  recordLeadResponse,
  scanLeadSlaBreaches,
} from "./lead-management/lead-intelligence.js";
export {
  bulkUpdateLeads,
  enqueueLeadBulkUpdateJob,
  getLeadBulkJob,
  LEAD_BULK_SYNC_LIMIT,
  resolveLeadBulkExecutionContext,
} from "./lead-management/lead-operations.js";
export {
  decideLeadQualification,
  getLeadQualification,
} from "./lead-management/lead-qualification.js";
export {
  scanLeadStageDwellBreaches,
} from "./lead-management/lifecycle/dwell-scan.js";
export {
  getLeadStage,
  isElevatedLifecycleActor,
} from "./lead-management/lifecycle/shared.js";
export {
  applyLeadStageTemplateUpgrade,
  classifyLeadStageCustomization,
  createLeadStage,
  FIVE_STAGE_LEAD_GRAPH,
  FIVE_STAGE_LEAD_TEMPLATE,
  getLeadStageDwell,
  listLeadStageHistory,
  listLeadStages,
  previewLeadStageTemplateUpgrade,
  reactivateLeadStage,
  updateLeadStage,
} from "./lead-management/lifecycle/stage-catalog.js";
export {
  deactivateLeadStageWithMigration,
  enqueueLeadStageMigrationJob,
  getLeadStageMigrationJob,
  processLeadStageMigrationBatch,
  STAGE_MIGRATION_BATCH_SIZE,
  STAGE_MIGRATION_JOB_TYPE,
} from "./lead-management/lifecycle/stage-migration.js";
export {
  transitionLeadStage,
} from "./lead-management/lifecycle/transition-engine.js";
export {
  addLeadStageTransition,
  createLeadStageTransitionReason,
  findApplicableTransitionReasons,
  listLeadStageTransitionReasons,
  listLeadStageTransitions,
  removeLeadStageTransition,
  setLeadStageTransitionReasonActive,
} from "./lead-management/lifecycle/transition-graph.js";
export {
  processLeadScoreRecalcBatch,
  SCORE_RECALC_JOB_TYPE,
} from "./lead-management/scoring/bulk-recalc.js";
export {
  activateLeadScoringModel,
  createLeadScoringModel,
  createLeadScoringModelRule,
  listLeadScoringModels,
  setLeadScoringModelRuleStatus,
  trainLeadScoringModel,
  updateLeadScoringModel,
} from "./lead-management/scoring/model-config.js";
export {
  getLeadScoreExplanation,
  recalculateLeadScore,
} from "./lead-management/scoring/scoring-engine.js";

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
  buildCrmLeadExportCsv,
  completeCrmLeadExportJob,
  enqueueCrmLeadExportJob,
  getCrmLeadExportJob,
  readCrmLeadExportArtifact,
} from "./data-management/import-export/lead-export.js";
export {
  commitLeadImport,
  finalizeLeadImport,
  getLeadImportBatch,
  getLeadImportErrorsCsv,
  LEAD_IMPORT_LIMITS,
  listCrmLeadImportBatches,
  previewLeadImport,
  processLeadImportChunk,
  rollbackLeadImport,
} from "./data-management/import-export/lead-import.js";
export {
  applyOfflineBatch,
} from "./data-management/offline-sync.js";
