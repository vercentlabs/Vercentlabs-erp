import { registerJobHandler } from "../registry.js";
import { internalJobBackoff } from "../backoff.js";
import { dispatchFollowUpRemindersHandler, JOB_TYPE as FOLLOW_UP_REMINDER_DISPATCH_JOB_TYPE, payloadSchema as followUpReminderDispatchPayloadSchema } from "./crm-follow-up-reminder-dispatch.js";
import { reportRunHandler, JOB_TYPE as REPORT_RUN_JOB_TYPE, payloadSchema as reportRunPayloadSchema } from "./platform-report-run.js";
import { reconcileReorderHandler, JOB_TYPE as REORDER_RECONCILE_JOB_TYPE, payloadSchema as reorderReconcilePayloadSchema } from "./stock-reorder-reconcile.js";
import { dispatchLowStockNotificationsHandler, JOB_TYPE as LOW_STOCK_DISPATCH_JOB_TYPE, payloadSchema as lowStockDispatchPayloadSchema } from "./stock-low-stock-dispatch.js";
import { notifyOverdueTasksHandler, JOB_TYPE as TASK_OVERDUE_JOB_TYPE, payloadSchema as taskOverduePayloadSchema } from "./crm-task-overdue.js";
import { notifyOverdueProductionHoldsHandler, JOB_TYPE as HOLD_OVERDUE_JOB_TYPE, payloadSchema as holdOverduePayloadSchema } from "./manufacturing-hold-overdue.js";
import { notifyProjectAlertsHandler, JOB_TYPE as PROJECT_ALERTS_JOB_TYPE, payloadSchema as projectAlertsPayloadSchema } from "./projects-alerts.js";
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
