import { createLogger } from "@vercentlabs/observability";

import { enqueueJob } from "./queue.js";
import { withTenantClient, listActiveOrganizationIds } from "./db.js";
import { JOB_TYPE as OVERDUE_ACTIVITY_JOB_TYPE } from "./handlers/crm-automation-overdue.js";
import { JOB_TYPE as QUOTATION_EXPIRY_SCAN_JOB_TYPE } from "./handlers/sales-quotation-expiry-scan.js";
import { JOB_TYPE as FOLLOW_UP_REMINDER_DISPATCH_JOB_TYPE } from "./handlers/crm-follow-up-reminder-dispatch.js";
import { JOB_TYPE as CALENDAR_SYNC_JOB_TYPE } from "./handlers/crm-calendar-sync.js";
import { JOB_TYPE as FORECAST_SNAPSHOT_JOB_TYPE } from "./handlers/crm-forecast-snapshot-capture.js";

const logger = createLogger("worker-scheduler");

// Scheduled sources: the activity.overdue detection tick, the Sales
// quotation-expiry scan (F038 — see sales-quotation-expiry-scan.js), the
// follow-up reminder dispatch, and the daily forecast snapshot (which uses a
// calendar-date idempotency key, `snapshotDay` below, rather than `bucket`,
// since it must fire once a day rather than once per tick). crm_automation_rules has no
// schedule/cron/interval column, so there is deliberately no generic
// per-rule scheduling DSL — these are one-off, system-level ticks on the
// same fixed interval.
//
// Duplicate-occurrence prevention across multiple scheduler instances
// reuses the SAME mechanism as ordinary job idempotency —
// no separate advisory-lock system was built. `bucket` is a deterministic
// function of wall-clock time and the configured tick interval, so two
// scheduler processes racing to enqueue for the same organization and the
// same bucket collide on tenant.background_jobs's
// UNIQUE(organization_id, idempotency_key) constraint; the loser's
// enqueueJob() call resolves to the winner's already-inserted row instead
// of creating a duplicate (see queue.js's enqueueJob doc comment).
export async function runSchedulerTick(pool, config) {
  const bucket = Math.floor(Date.now() / config.worker.schedulerTickMilliseconds);
  // A calendar date (UTC): a once-a-day job enqueued on every tick dedupes
  // against the first one of the day.
  const snapshotDay = new Date().toISOString().slice(0, 10);
  const organizationIds = await listActiveOrganizationIds(pool);
  let enqueued = 0;
  let deduped = 0;
  for (const organizationId of organizationIds) {
    try {
      const { deduped: wasDeduped } = await withTenantClient(pool, organizationId, (client) =>
        enqueueJob(client, organizationId, {
          jobType: OVERDUE_ACTIVITY_JOB_TYPE,
          idempotencyKey: `overdue-tick:${bucket}`,
          maxAttempts: 3,
        }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("scheduler tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
    try {
      const { deduped: wasDeduped } = await withTenantClient(pool, organizationId, (client) =>
        enqueueJob(client, organizationId, {
          jobType: QUOTATION_EXPIRY_SCAN_JOB_TYPE,
          idempotencyKey: `quotation-expiry-scan-tick:${bucket}`,
          maxAttempts: 3,
        }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("quotation expiry scan tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
    try {
      // F016: reminders need frequent (per-tick), not daily, checking —
      // uses `bucket` like the other high-frequency ticks above, not
      // `snapshotDay`. claimDueReminders() itself only claims rows whose
      // fire_at has actually passed, so an idle tick is cheap and a no-op.
      const { deduped: wasDeduped } = await withTenantClient(pool, organizationId, (client) =>
        enqueueJob(client, organizationId, {
          jobType: FOLLOW_UP_REMINDER_DISPATCH_JOB_TYPE,
          idempotencyKey: `follow-up-reminder-dispatch-tick:${bucket}`,
          maxAttempts: 3,
        }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("follow-up reminder dispatch tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
    try {
      // F014 inbound calendar sync: per tick; the handler claims only
      // connected accounts not synced in the last CALENDAR_SYNC_INTERVAL_MINUTES.
      const { deduped: wasDeduped } = await withTenantClient(pool, organizationId, (client) =>
        enqueueJob(client, organizationId, {
          jobType: CALENDAR_SYNC_JOB_TYPE,
          idempotencyKey: `calendar-sync-tick:${bucket}`,
          maxAttempts: 3,
        }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("calendar sync tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
    try {
      // F025 daily forecast snapshot (calendar-date key).
      const { deduped: wasDeduped } = await withTenantClient(pool, organizationId, (client) =>
        enqueueJob(client, organizationId, {
          jobType: FORECAST_SNAPSHOT_JOB_TYPE,
          idempotencyKey: `forecast-snapshot-tick:${snapshotDay}`,
          payload: { date: snapshotDay },
          maxAttempts: 3,
        }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("forecast snapshot tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
  }
  logger.info("scheduler tick complete", { organizations: organizationIds.length, enqueued, deduped, bucket });
  return { organizations: organizationIds.length, enqueued, deduped };
}
