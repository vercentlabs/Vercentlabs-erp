// Stable public CRM API boundary. Implementation is owned by the eight canonical capability directories.
export { getMetricDrilldown, getMetricRollup, getPipelineBreakdown, getPipelineDashboard, getPipelineMetrics } from "./analytics/pipeline-metrics.js";
export { analyticsFiltersFromSearchParams, normalizeAnalyticsFilters } from "./analytics/opportunity-facts.js";
export { BREAKDOWN_DIMENSIONS, listMetricDefinitions, METRIC_VERSION, PIPELINE_METRICS } from "./analytics/metric-definitions.js";
export { CrmError } from "./data-management/errors.js";
export { archiveCrmRecord, createCrmRecord, updateCrmRecord } from "./data-management/resource-mutation-service.js";
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
export * from "./conversion/index.js";
export * from "./quotations/index.js";
export * from "./close-reasons/index.js";
export * from "./workspace/index.js";

export { taskOverdueSql } from "./data-management/activity-query-rules.js";

export { resolveCrmEntityAccess } from "./data-management/entity-access.js";

export {
  claimDueReminders, createRemindersForActivity, cancelPendingRemindersForActivity, markReminderOutcome, resetStuckDispatchingReminders,
  replaceActivityReminder, snoozeActivityReminder,
} from "./reminders/index.js";



export {
  getCrmTimelinePage as getCrmRecordTimelinePage,
  getCrmTimelinePageBySource,
} from "./activities/timeline/timeline.js";

// Commands, queries and job entry points that first-party consumers (web API
// routes, worker handlers) already used through the package root, plus the
// lead lifecycle/duplicate names this boundary's index.d.ts already declared.
// Package consumers import them from @vercentlabs/api/crm.

// Leads: the record, lifecycle, assignment, qualification, duplicates,
// conversion, activities, sources, import/export, dashboard and report.
export * from "./leads/index.js";
export * from "./duplicates/index.js";
export * from "./opportunities/index.js";
export * from "./accounts/index.js";
export * from "./contacts/index.js";
