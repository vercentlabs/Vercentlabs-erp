import { registerJobHandler } from "../registry.js";
import { internalJobBackoff } from "../backoff.js";
import { detectOverdueActivitiesHandler, JOB_TYPE as OVERDUE_ACTIVITY_JOB_TYPE, payloadSchema as overdueActivityPayloadSchema } from "./crm-automation-overdue.js";
import { leadBulkUpdateHandler, JOB_TYPE as LEAD_BULK_JOB_TYPE, payloadSchema as leadBulkPayloadSchema } from "./crm-lead-bulk-update.js";
import { opportunityBulkUpdateHandler, JOB_TYPE as OPPORTUNITY_BULK_JOB_TYPE, payloadSchema as opportunityBulkPayloadSchema } from "./crm-opportunity-bulk-update.js";
import { detectLeadSlaBreachesHandler, JOB_TYPE as LEAD_SLA_SCAN_JOB_TYPE, payloadSchema as leadSlaScanPayloadSchema } from "./crm-lead-sla-scan.js";
import { leadStageMigrationHandler, JOB_TYPE as LEAD_STAGE_MIGRATION_JOB_TYPE, payloadSchema as leadStageMigrationPayloadSchema } from "./crm-lead-stage-migration.js";
import { detectLeadStageDwellBreachesHandler, JOB_TYPE as LEAD_DWELL_SCAN_JOB_TYPE, payloadSchema as leadDwellScanPayloadSchema } from "./crm-lead-stage-dwell-scan.js";
import { leadScoreRecalcHandler, JOB_TYPE as LEAD_SCORE_RECALC_JOB_TYPE, payloadSchema as leadScoreRecalcPayloadSchema } from "./crm-lead-score-recalc.js";
import { detectExpiredQuotationsHandler, JOB_TYPE as QUOTATION_EXPIRY_SCAN_JOB_TYPE, payloadSchema as quotationExpiryScanPayloadSchema } from "./sales-quotation-expiry-scan.js";
import { opportunityStageMigrationHandler, JOB_TYPE as OPPORTUNITY_STAGE_MIGRATION_JOB_TYPE, payloadSchema as opportunityStageMigrationPayloadSchema } from "./crm-opportunity-stage-migration.js";
import { capturePipelineDailySnapshotHandler, JOB_TYPE as PIPELINE_SNAPSHOT_CAPTURE_JOB_TYPE, payloadSchema as pipelineSnapshotCapturePayloadSchema } from "./crm-pipeline-snapshot-capture.js";
import { dispatchFollowUpRemindersHandler, JOB_TYPE as FOLLOW_UP_REMINDER_DISPATCH_JOB_TYPE, payloadSchema as followUpReminderDispatchPayloadSchema } from "./crm-follow-up-reminder-dispatch.js";
import { pushMeetingCalendarEventHandler, JOB_TYPE as MEETING_CALENDAR_PUSH_JOB_TYPE, payloadSchema as meetingCalendarPushPayloadSchema } from "./crm-meeting-calendar-push.js";
import { dispatchNurtureQueueNotificationsHandler, JOB_TYPE as NURTURE_QUEUE_DISPATCH_JOB_TYPE, payloadSchema as nurtureQueueDispatchPayloadSchema } from "./crm-nurture-queue-dispatch.js";

// Registers every currently-wired job type. Called once at worker
// startup (bin/start.mjs) and by tests that need a populated registry.
// This is the "typed/validated handler registry" (Part 5) — the single
// place new job types get added, never a switch scattered through
// worker.js.
export function registerBuiltinHandlers() {
  registerJobHandler(OVERDUE_ACTIVITY_JOB_TYPE, {
    schema: overdueActivityPayloadSchema,
    handler: detectOverdueActivitiesHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // the status-transition WHERE clause makes re-running this handler for the same org always safe
    maxAttempts: 3,
  });
  registerJobHandler(LEAD_BULK_JOB_TYPE, {
    schema: leadBulkPayloadSchema,
    handler: leadBulkUpdateHandler,
    backoff: internalJobBackoff,
    idempotency: "IDEMPOTENCY_KEY_REQUIRED",
    maxAttempts: 5,
    transactionMode: "managed",
  });
  registerJobHandler(OPPORTUNITY_BULK_JOB_TYPE, {
    schema: opportunityBulkPayloadSchema,
    handler: opportunityBulkUpdateHandler,
    backoff: internalJobBackoff,
    idempotency: "IDEMPOTENCY_KEY_REQUIRED",
    maxAttempts: 5,
    transactionMode: "managed",
  });
  registerJobHandler(LEAD_SLA_SCAN_JOB_TYPE, {
    schema: leadSlaScanPayloadSchema,
    handler: detectLeadSlaBreachesHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // same status-transition guarantee as the overdue-activity tick
    maxAttempts: 3,
  });
  registerJobHandler(LEAD_STAGE_MIGRATION_JOB_TYPE, {
    schema: leadStageMigrationPayloadSchema,
    handler: leadStageMigrationHandler,
    backoff: internalJobBackoff,
    idempotency: "IDEMPOTENCY_KEY_REQUIRED",
    maxAttempts: 5,
    transactionMode: "managed",
  });
  registerJobHandler(LEAD_DWELL_SCAN_JOB_TYPE, {
    schema: leadDwellScanPayloadSchema,
    handler: detectLeadStageDwellBreachesHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // dwell_breach_notified_at makes a re-run of the same tick a no-op for leads already notified
    maxAttempts: 3,
  });
  registerJobHandler(LEAD_SCORE_RECALC_JOB_TYPE, {
    schema: leadScoreRecalcPayloadSchema,
    handler: leadScoreRecalcHandler,
    backoff: internalJobBackoff,
    idempotency: "IDEMPOTENCY_KEY_REQUIRED",
    maxAttempts: 5,
    transactionMode: "managed",
  });
  registerJobHandler(QUOTATION_EXPIRY_SCAN_JOB_TYPE, {
    schema: quotationExpiryScanPayloadSchema,
    handler: detectExpiredQuotationsHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // same status-transition guarantee as the overdue-activity/lead-SLA ticks
    maxAttempts: 3,
  });
  registerJobHandler(OPPORTUNITY_STAGE_MIGRATION_JOB_TYPE, {
    schema: opportunityStageMigrationPayloadSchema,
    handler: opportunityStageMigrationHandler,
    backoff: internalJobBackoff,
    idempotency: "IDEMPOTENCY_KEY_REQUIRED",
    maxAttempts: 5,
    transactionMode: "managed",
  });
  registerJobHandler(PIPELINE_SNAPSHOT_CAPTURE_JOB_TYPE, {
    schema: pipelineSnapshotCapturePayloadSchema,
    handler: capturePipelineDailySnapshotHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // the scheduled partial-unique-index ON CONFLICT DO NOTHING makes a re-run for the same org/day always safe
    maxAttempts: 3,
  });
  registerJobHandler(FOLLOW_UP_REMINDER_DISPATCH_JOB_TYPE, {
    schema: followUpReminderDispatchPayloadSchema,
    handler: dispatchFollowUpRemindersHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // claimDueReminders() uses FOR UPDATE SKIP LOCKED + a pending->dispatching status move, so an overlapping/re-run tick can never claim or resend a reminder another tick already claimed
    maxAttempts: 3,
  });
  registerJobHandler(MEETING_CALENDAR_PUSH_JOB_TYPE, {
    schema: meetingCalendarPushPayloadSchema,
    handler: pushMeetingCalendarEventHandler,
    backoff: internalJobBackoff,
    // A "create" push with no externalEventId yet is NOT naturally
    // idempotent — retrying after a lost response (the provider actually
    // created the event, but the job's HTTP call to us timed out) could
    // create a duplicate calendar event. A caller-supplied idempotency key
    // (see enqueueCalendarPushJob) makes a re-enqueue for the same
    // meeting+action collide on the same background_jobs row instead.
    idempotency: "IDEMPOTENCY_KEY_REQUIRED",
    maxAttempts: 5,
    transactionMode: "managed",
  });
  registerJobHandler(NURTURE_QUEUE_DISPATCH_JOB_TYPE, {
    schema: nurtureQueueDispatchPayloadSchema,
    handler: dispatchNurtureQueueNotificationsHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // claimDueNurtureQueueItems() uses FOR UPDATE SKIP LOCKED and marks notified_at atomically in the same claim UPDATE, so an overlapping/re-run tick can never claim or re-notify an item another tick already claimed
    maxAttempts: 3,
  });
}
