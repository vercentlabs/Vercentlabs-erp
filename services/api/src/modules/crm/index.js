// Stable public CRM API boundary. Implementation is owned by the eight canonical capability directories.
export { getMetricDrilldown, getMetricRollup, getPipelineBreakdown, getPipelineDashboard, getPipelineMetrics } from "./analytics/pipeline-metrics.js";
export { analyticsFiltersFromSearchParams, normalizeAnalyticsFilters } from "./analytics/opportunity-facts.js";
export { BREAKDOWN_DIMENSIONS, listMetricDefinitions, METRIC_VERSION, PIPELINE_METRICS } from "./analytics/metric-definitions.js";
export { CrmError } from "./data-management/errors.js";
export { getCrmOptions } from "./data-management/resource-options.js";
export { queueOutboxEvent } from "./data-management/outbox.js";
export { canViewAllCrmRecords, recordScope } from "./data-management/record-policy.js";
export { resources } from "./data-management/resource-registry.js";
export { addSalesTeamMember, archiveSalesTeam, archiveSalesTeamMember, createSalesTeam, getSalesTeam, listSalesTeamMembers, listSalesTeams, SALES_TEAM_MEMBER_ROLES, updateSalesTeam } from "./sales-organization/teams.js";

export * from "./pipeline/index.js";
export * from "./sales-stages/index.js";
export * from "./tasks/index.js";
export * from "./follow-ups/index.js";
export * from "./notes/index.js";
export * from "./attachments/index.js";
export * from "./conversion/index.js";
export * from "./quotations/index.js";
export * from "./quotes/index.js";
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
export * from "./data-jobs/index.js";
export * from "./email/index.js";
export * from "./capture-forms/index.js";
export * from "./connectors/index.js";
export * from "./campaigns/index.js";
export * from "./tags/index.js";
export * from "./reports/index.js";
export * from "./whatsapp/index.js";
export * from "./channels/index.js";
export * from "./meetings/index.js";
export * from "./followers/index.js";
export * from "./activity-types/index.js";
export * from "./custom-fields/index.js";
export * from "./recurring/index.js";
export * from "./images/index.js";
export * from "./saved-views/index.js";
export * from "./gst/index.js";
export * from "./holidays/index.js";
export * from "./access-levels/index.js";
export * from "./mailings/index.js";
export * from "./chat/index.js";
// The leads switch, past-history import and moving in from other tools (CRM plan 5.7).
export { convertArrivingLead, leadsEnabled, setLeadsEnabled } from "./leads/switch.js";
export { HISTORY_IMPORT_COLUMNS, analyzeHistoryImport, buildHistoryImportTemplate, importRecordHistory } from "./data-management/history-import.js";
export { MIGRATION_SOURCES } from "./data-management/migration-presets.js";
export { SCORING_FIELDS, createLeadScoringRule, deleteLeadScoringRule, getLeadScoring, rescoreLead, rescoreOpenLeads, saveLeadScoringSettings, updateLeadScoringRule } from "./leads/scoring.js";
export { CONSENT_LOCK_DAYS, addOptOut, assertConsentRequestAllowed, findPersonalData, listConsentHistory, listOptOuts, optOutOf, removeOptOut, withConsentSource } from "./data-management/consent.js";
export * from "./accounts/index.js";
export * from "./contacts/index.js";

// CRM actions in the central audit log (CRM plan 5.7): these named exports take the place of the plain ones re-exported above.
export {
  bulkAssignAccounts, bulkAssignContacts, bulkAssignLeads, bulkAssignOpportunities, bulkChangeLeadStage, bulkChangeOpportunityStage, bulkConvertLeads, bulkDisqualifyLeads,
  bulkSetAccountStatus, bulkSetContactStatus, bulkUpdateFollowUps, bulkUpdateTasks, exportAccounts, exportContacts, exportFollowUps, exportLeads, exportOpportunities, exportTasks,
  mergeAccounts, mergeContacts, mergeLeads, mergeOpportunities,
} from "./data-management/audited.js";

// To-dos: tasks and follow-ups in one list (CRM audit navigation).
export { listTodos, TODO_VIEWS } from "./todos/records.js";

// The CRM Inbox: chats, WhatsApp and emails from customers in one list (CRM audit navigation).
export { listInbox } from "./inbox/records.js";
export { listAllDealQuotes } from "./quotes/list.js";
