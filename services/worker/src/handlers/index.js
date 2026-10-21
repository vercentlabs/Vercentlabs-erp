import { registerJobHandler } from "../registry.js";
import { internalJobBackoff } from "../backoff.js";
import { dispatchFollowUpRemindersHandler, JOB_TYPE as FOLLOW_UP_REMINDER_DISPATCH_JOB_TYPE, payloadSchema as followUpReminderDispatchPayloadSchema } from "./crm-follow-up-reminder-dispatch.js";
import { calendarSyncHandler, JOB_TYPE as CALENDAR_SYNC_JOB_TYPE, payloadSchema as calendarSyncPayloadSchema } from "./crm-calendar-sync.js";
import { mailingsSendHandler, JOB_TYPE as MAILINGS_SEND_JOB_TYPE, payloadSchema as mailingsSendPayloadSchema } from "./crm-mailings-send.js";
import { whatsAppBroadcastsSendHandler, JOB_TYPE as BROADCASTS_SEND_JOB_TYPE, payloadSchema as broadcastsSendPayloadSchema } from "./crm-whatsapp-broadcasts-send.js";
import { leadResponseWatchHandler, JOB_TYPE as LEAD_RESPONSE_WATCH_JOB_TYPE, payloadSchema as leadResponseWatchPayloadSchema } from "./crm-lead-response-watch.js";
import { pollLeadConnectorsHandler, JOB_TYPE as LEAD_CONNECTORS_POLL_JOB_TYPE, payloadSchema as leadConnectorsPollPayloadSchema } from "./crm-lead-connectors-poll.js";
import { crmDataJobHandler, JOB_TYPE as CRM_DATA_JOB_TYPE, payloadSchema as crmDataJobPayloadSchema } from "./crm-data-job.js";
import { reportRunHandler, JOB_TYPE as REPORT_RUN_JOB_TYPE, payloadSchema as reportRunPayloadSchema } from "./platform-report-run.js";
import { reconcileReorderHandler, JOB_TYPE as REORDER_RECONCILE_JOB_TYPE, payloadSchema as reorderReconcilePayloadSchema } from "./stock-reorder-reconcile.js";
import { dispatchLowStockNotificationsHandler, JOB_TYPE as LOW_STOCK_DISPATCH_JOB_TYPE, payloadSchema as lowStockDispatchPayloadSchema } from "./stock-low-stock-dispatch.js";
import { notifyOverdueTasksHandler, JOB_TYPE as TASK_OVERDUE_JOB_TYPE, payloadSchema as taskOverduePayloadSchema } from "./crm-task-overdue.js";
import { notifyOverdueProductionHoldsHandler, JOB_TYPE as HOLD_OVERDUE_JOB_TYPE, payloadSchema as holdOverduePayloadSchema } from "./manufacturing-hold-overdue.js";
import { notifyProjectAlertsHandler, JOB_TYPE as PROJECT_ALERTS_JOB_TYPE, payloadSchema as projectAlertsPayloadSchema } from "./projects-alerts.js";
import { noteExpiredQuotationsHandler, JOB_TYPE as QUOTATION_EXPIRY_JOB_TYPE, payloadSchema as quotationExpiryPayloadSchema } from "./sales-quotation-expiry.js";
import { buildWorkspaceExportHandler, JOB_TYPE as WORKSPACE_EXPORT_JOB_TYPE, payloadSchema as workspaceExportPayloadSchema } from "./platform-workspace-export.js";
import { exchangeRateFeedHandler, JOB_TYPE as EXCHANGE_RATE_FEED_JOB_TYPE, payloadSchema as exchangeRateFeedPayloadSchema } from "./platform-exchange-rate-feed.js";
import { workflowTimeTriggersHandler, JOB_TYPE as WORKFLOW_TIME_TRIGGERS_JOB_TYPE, payloadSchema as workflowTimeTriggersPayloadSchema } from "./platform-workflow-time-triggers.js";
import { notificationDigestHandler, JOB_TYPE as NOTIFICATION_DIGEST_JOB_TYPE, payloadSchema as notificationDigestPayloadSchema } from "./platform-notification-digest.js";
import { remindRecordActivitiesHandler, JOB_TYPE as RECORD_ACTIVITY_REMINDER_JOB_TYPE, payloadSchema as recordActivityReminderPayloadSchema } from "./platform-record-activity-reminders.js";
import { runDepreciationAutomationHandler, JOB_TYPE as DEPRECIATION_AUTOMATION_JOB_TYPE, payloadSchema as depreciationAutomationPayloadSchema } from "./assets-depreciation-automation.js";
import { runMaintenanceScheduleHandler, JOB_TYPE as MAINTENANCE_SCHEDULE_JOB_TYPE, payloadSchema as maintenanceSchedulePayloadSchema } from "./assets-maintenance.js";

// Registers every currently-wired job type. Called once at worker
// startup (bin/start.mjs) and by tests that need a populated registry.
// This is the typed/validated handler registry — the single
// place new job types get added, never a switch scattered through
// worker.js.
export function registerBuiltinHandlers() {
  registerJobHandler(FOLLOW_UP_REMINDER_DISPATCH_JOB_TYPE, {
    schema: followUpReminderDispatchPayloadSchema,
    handler: dispatchFollowUpRemindersHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // claimDueReminders() uses FOR UPDATE SKIP LOCKED + a pending->dispatching status move, so an overlapping/re-run tick can never claim or resend a reminder another tick already claimed
    maxAttempts: 3,
  });
  registerJobHandler(REPORT_RUN_JOB_TYPE, {
    schema: reportRunPayloadSchema,
    handler: reportRunHandler,
    backoff: internalJobBackoff,
    // A completed run is skipped on replay (executeReportRun checks status),
    // and its output is written in the same transaction as the status.
    idempotency: "NATURALLY_IDEMPOTENT",
    maxAttempts: 2,
    transactionMode: "managed",
  });
  registerJobHandler(CRM_DATA_JOB_TYPE, {
    schema: crmDataJobPayloadSchema,
    handler: crmDataJobHandler,
    backoff: internalJobBackoff,
    // A finished or failed run is skipped on replay (executeCrmDataJob checks status), and an import's rows, its result and its
    // output file are written in one transaction with the status.
    idempotency: "NATURALLY_IDEMPOTENT",
    maxAttempts: 2,
    transactionMode: "managed",
  });
  registerJobHandler(MAILINGS_SEND_JOB_TYPE, {
    schema: mailingsSendPayloadSchema,
    handler: mailingsSendHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // each recipient is claimed and marked in one transaction; a sent one is never queued again
    maxAttempts: 2,
  });
  registerJobHandler(BROADCASTS_SEND_JOB_TYPE, {
    schema: broadcastsSendPayloadSchema,
    handler: whatsAppBroadcastsSendHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // as campaign emails: claimed and marked in one transaction
    maxAttempts: 2,
  });
  registerJobHandler(CALENDAR_SYNC_JOB_TYPE, {
    schema: calendarSyncPayloadSchema,
    handler: calendarSyncHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // events are mapped to their activity and changed only when the meeting's version changed
    maxAttempts: 2,
  });
  registerJobHandler(LEAD_RESPONSE_WATCH_JOB_TYPE, {
    schema: leadResponseWatchPayloadSchema,
    handler: leadResponseWatchHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // every notice is stamped in the statement that claims its row (SKIP LOCKED); the re-run moves last_rerun_at first
    maxAttempts: 3,
  });
  registerJobHandler(LEAD_CONNECTORS_POLL_JOB_TYPE, {
    schema: leadConnectorsPollPayloadSchema,
    handler: pollLeadConnectorsHandler,
    backoff: internalJobBackoff,
    // UNIQUE(connector, provider lead id) makes each lead once; a connector's read window moves only when its leads are written.
    idempotency: "NATURALLY_IDEMPOTENT",
    maxAttempts: 2,
    transactionMode: "managed",
  });
  registerJobHandler(REORDER_RECONCILE_JOB_TYPE, {
    schema: reorderReconcilePayloadSchema,
    handler: reconcileReorderHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // recalculates a rebuildable projection from its sources
    maxAttempts: 3,
  });
  registerJobHandler(LOW_STOCK_DISPATCH_JOB_TYPE, {
    schema: lowStockDispatchPayloadSchema,
    handler: dispatchLowStockNotificationsHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // each queued transition is claimed and marked dispatched once
    maxAttempts: 3,
  });
  registerJobHandler(TASK_OVERDUE_JOB_TYPE, {
    schema: taskOverduePayloadSchema,
    handler: notifyOverdueTasksHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // each overdue task is stamped once
    maxAttempts: 3,
  });
  registerJobHandler(HOLD_OVERDUE_JOB_TYPE, {
    schema: holdOverduePayloadSchema,
    handler: notifyOverdueProductionHoldsHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // each overdue hold is stamped once
    maxAttempts: 3,
  });
  registerJobHandler(PROJECT_ALERTS_JOB_TYPE, {
    schema: projectAlertsPayloadSchema,
    handler: notifyProjectAlertsHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // UNIQUE(organization, project, alert_key) makes each alert once
    maxAttempts: 3,
  });
  registerJobHandler(EXCHANGE_RATE_FEED_JOB_TYPE, {
    schema: exchangeRateFeedPayloadSchema,
    handler: exchangeRateFeedHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // one rate per currency and day (upsert)
    maxAttempts: 3,
  });
  registerJobHandler(WORKFLOW_TIME_TRIGGERS_JOB_TYPE, {
    schema: workflowTimeTriggersPayloadSchema,
    handler: workflowTimeTriggersHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // one run per automation, record and day (unique idempotency key)
    maxAttempts: 3,
  });
  registerJobHandler(NOTIFICATION_DIGEST_JOB_TYPE, {
    schema: notificationDigestPayloadSchema,
    handler: notificationDigestHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // digest_sent_on stamps each person once a day
    maxAttempts: 3,
  });
  registerJobHandler(RECORD_ACTIVITY_REMINDER_JOB_TYPE, {
    schema: recordActivityReminderPayloadSchema,
    handler: remindRecordActivitiesHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // reminded_at stamps each activity once a day
    maxAttempts: 3,
  });
  registerJobHandler(WORKSPACE_EXPORT_JOB_TYPE, {
    schema: workspaceExportPayloadSchema,
    handler: buildWorkspaceExportHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // each run writes its own export file; nothing else changes
    maxAttempts: 2,
  });
  registerJobHandler(QUOTATION_EXPIRY_JOB_TYPE, {
    schema: quotationExpiryPayloadSchema,
    handler: noteExpiredQuotationsHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // the quotation.expired history event marks each quotation once
    maxAttempts: 3,
  });
  registerJobHandler(DEPRECIATION_AUTOMATION_JOB_TYPE, {
    schema: depreciationAutomationPayloadSchema,
    handler: runDepreciationAutomationHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // UNIQUE(organization, execution_key) per book and month, an advisory lock per Company, and idempotent posting by the run's source
    maxAttempts: 3,
  });
  registerJobHandler(MAINTENANCE_SCHEDULE_JOB_TYPE, {
    schema: maintenanceSchedulePayloadSchema,
    handler: runMaintenanceScheduleHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // UNIQUE(plan, due_date) per occurrence, an advisory lock per Company, and one overdue notice per Work Order and day
    maxAttempts: 3,
  });
}
