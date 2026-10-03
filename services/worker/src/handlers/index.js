import { registerJobHandler } from "../registry.js";
import { internalJobBackoff } from "../backoff.js";
import { detectOverdueActivitiesHandler, JOB_TYPE as OVERDUE_ACTIVITY_JOB_TYPE, payloadSchema as overdueActivityPayloadSchema } from "./crm-automation-overdue.js";
import { opportunityBulkUpdateHandler, JOB_TYPE as OPPORTUNITY_BULK_JOB_TYPE, payloadSchema as opportunityBulkPayloadSchema } from "./crm-opportunity-bulk-update.js";
import { detectExpiredQuotationsHandler, JOB_TYPE as QUOTATION_EXPIRY_SCAN_JOB_TYPE, payloadSchema as quotationExpiryScanPayloadSchema } from "./sales-quotation-expiry-scan.js";
import { opportunityStageMigrationHandler, JOB_TYPE as OPPORTUNITY_STAGE_MIGRATION_JOB_TYPE, payloadSchema as opportunityStageMigrationPayloadSchema } from "./crm-opportunity-stage-migration.js";
import { capturePipelineDailySnapshotHandler, JOB_TYPE as PIPELINE_SNAPSHOT_CAPTURE_JOB_TYPE, payloadSchema as pipelineSnapshotCapturePayloadSchema } from "./crm-pipeline-snapshot-capture.js";
import { dispatchFollowUpRemindersHandler, JOB_TYPE as FOLLOW_UP_REMINDER_DISPATCH_JOB_TYPE, payloadSchema as followUpReminderDispatchPayloadSchema } from "./crm-follow-up-reminder-dispatch.js";
import { pushMeetingCalendarEventHandler, JOB_TYPE as MEETING_CALENDAR_PUSH_JOB_TYPE, payloadSchema as meetingCalendarPushPayloadSchema } from "./crm-meeting-calendar-push.js";
import { duplicateFullScanHandler, JOB_TYPE as DUPLICATE_FULL_SCAN_JOB_TYPE, payloadSchema as duplicateFullScanPayloadSchema } from "./crm-duplicate-full-scan.js";
import { reportRunHandler, JOB_TYPE as REPORT_RUN_JOB_TYPE, payloadSchema as reportRunPayloadSchema } from "./platform-report-run.js";
import { captureForecastSnapshotsHandler, JOB_TYPE as FORECAST_SNAPSHOT_JOB_TYPE, payloadSchema as forecastSnapshotPayloadSchema } from "./crm-forecast-snapshot-capture.js";
import { syncCalendarAccountsHandler, JOB_TYPE as CALENDAR_SYNC_JOB_TYPE, payloadSchema as calendarSyncPayloadSchema } from "./crm-calendar-sync.js";

// Registers every currently-wired job type. Called once at worker
// startup (bin/start.mjs) and by tests that need a populated registry.
// This is the typed/validated handler registry — the single
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
  registerJobHandler(OPPORTUNITY_BULK_JOB_TYPE, {
    schema: opportunityBulkPayloadSchema,
    handler: opportunityBulkUpdateHandler,
    backoff: internalJobBackoff,
    idempotency: "IDEMPOTENCY_KEY_REQUIRED",
    maxAttempts: 5,
    transactionMode: "managed",
  });
  registerJobHandler(QUOTATION_EXPIRY_SCAN_JOB_TYPE, {
    schema: quotationExpiryScanPayloadSchema,
    handler: detectExpiredQuotationsHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // same status-transition guarantee as the overdue-activity tick
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
  registerJobHandler(DUPLICATE_FULL_SCAN_JOB_TYPE, {
    schema: duplicateFullScanPayloadSchema,
    handler: duplicateFullScanHandler,
    backoff: internalJobBackoff,
    // Re-running the same job id just re-pages from its own stored keyset
    // position and ON CONFLICT-upserts the same match rows — no side
    // effect on any other data, so no caller-supplied idempotency key is
    // required.
    idempotency: "NATURALLY_IDEMPOTENT",
    maxAttempts: 3,
    transactionMode: "managed",
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
  registerJobHandler(CALENDAR_SYNC_JOB_TYPE, {
    schema: calendarSyncPayloadSchema,
    handler: syncCalendarAccountsHandler,
    backoff: internalJobBackoff,
    // Claims accounts with SKIP LOCKED and a lease; provider events upsert on
    // UNIQUE(organization, provider, external_event_id), so a re-run or an
    // overlapping tick can never duplicate an event.
    idempotency: "NATURALLY_IDEMPOTENT",
    maxAttempts: 3,
    transactionMode: "managed",
  });
  registerJobHandler(FORECAST_SNAPSHOT_JOB_TYPE, {
    schema: forecastSnapshotPayloadSchema,
    handler: captureForecastSnapshotsHandler,
    backoff: internalJobBackoff,
    idempotency: "NATURALLY_IDEMPOTENT", // UNIQUE(organization, period, capture_key='scheduled:<date>') makes a re-run a no-op
    maxAttempts: 3,
  });
}
