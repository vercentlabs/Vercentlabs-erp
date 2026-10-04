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
export { getCrmOptions } from "./data-management/resource-options.js";
export { queueOutboxEvent } from "./data-management/outbox.js";
export { canViewAllCrmRecords, recordScope } from "./data-management/record-policy.js";
export { getCrmRecord, listCrmRecords } from "./data-management/resource-query-service.js";
export { isCrmResource, resources } from "./data-management/resource-registry.js";

export * from "./pipeline/index.js";
export * from "./sales-stages/index.js";
export * from "./tasks/index.js";
export * from "./follow-ups/index.js";
export * from "./notes/index.js";
export * from "./attachments/index.js";

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



export { taskOverdueSql } from "./data-management/activity-query-rules.js";

export { resolveCrmEntityAccess } from "./data-management/entity-access.js";

export {
  communicationVisibilitySql,
  projectCrmCommunication,
  projectCrmCommunications,
  resolveCallerParticipantCommunicationIds,
} from "./data-management/communication-access.js";
export { resolveCommunicationParticipants } from "./activities/communications/communication-projection.js";


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
  claimDueReminders, createRemindersForActivity, cancelPendingRemindersForActivity, listRemindersForActivity, markReminderOutcome, resetStuckDispatchingReminders,
  replaceActivityReminder, snoozeActivityReminder,
} from "./reminders/index.js";

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

// Privacy: data-subject requests and retention.
export * from "./privacy/index.js";


// F009-F012 Opportunity bulk jobs, contact roles, stage ageing, snapshots, forecasts and stage migration.
export {
  capturePredictiveForecast,
  getForecastCalibration,
} from "./pipeline/opportunity-revenue-intelligence.js";

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
export * from "./duplicates/index.js";
export * from "./opportunities/index.js";
export * from "./accounts/index.js";
export * from "./contacts/index.js";
