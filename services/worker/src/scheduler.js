import { createLogger } from "@vercentlabs/observability";

import { enqueueJob } from "./queue.js";
import { withTenantClient, listActiveOrganizationIds } from "./db.js";
import { JOB_TYPE as FOLLOW_UP_REMINDER_DISPATCH_JOB_TYPE } from "./handlers/crm-follow-up-reminder-dispatch.js";
import { JOB_TYPE as TASK_OVERDUE_JOB_TYPE } from "./handlers/crm-task-overdue.js";
import { JOB_TYPE as REORDER_RECONCILE_JOB_TYPE } from "./handlers/stock-reorder-reconcile.js";
import { JOB_TYPE as LOW_STOCK_DISPATCH_JOB_TYPE } from "./handlers/stock-low-stock-dispatch.js";
import { JOB_TYPE as HOLD_OVERDUE_JOB_TYPE } from "./handlers/manufacturing-hold-overdue.js";
import { JOB_TYPE as PROJECT_ALERTS_JOB_TYPE } from "./handlers/projects-alerts.js";
import { JOB_TYPE as DEPRECIATION_AUTOMATION_JOB_TYPE } from "./handlers/assets-depreciation-automation.js";
import { JOB_TYPE as MAINTENANCE_SCHEDULE_JOB_TYPE } from "./handlers/assets-maintenance.js";

const logger = createLogger("worker-scheduler");

// Scheduled sources: per-tick jobs (follow-up reminders, overdue tasks, low stock, overdue holds) keyed by `bucket`, and once-a-day jobs (reorder
// reconciliation, project alerts) keyed by the calendar date, `snapshotDay` below. These are one-off, system-level ticks on the same fixed
// interval.
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
      // F016: reminders need frequent (per-tick), not daily, checking —
      // uses `bucket` like the other high-frequency ticks, not
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
      // Reorder Level daily reconciliation (calendar-date key): every rule's status recalculated from its sources.
      const { deduped: wasDeduped } = await withTenantClient(pool, organizationId, (client) =>
        enqueueJob(client, organizationId, {
          jobType: REORDER_RECONCILE_JOB_TYPE,
          idempotencyKey: `reorder-reconcile-tick:${snapshotDay}`,
          payload: { date: snapshotDay },
          maxAttempts: 3,
        }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("reorder reconciliation tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
    try {
      // Low-stock alert notifications: per tick (an idle tick finds nothing pending and is a no-op).
      const { deduped: wasDeduped } = await withTenantClient(pool, organizationId, (client) =>
        enqueueJob(client, organizationId, {
          jobType: LOW_STOCK_DISPATCH_JOB_TYPE,
          idempotencyKey: `low-stock-dispatch-tick:${bucket}`,
          maxAttempts: 3,
        }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("low-stock notification tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
    try {
      // Overdue CRM tasks: per tick (each task's assignee is told once).
      const { deduped: wasDeduped } = await withTenantClient(pool, organizationId, (client) =>
        enqueueJob(client, organizationId, {
          jobType: TASK_OVERDUE_JOB_TYPE,
          idempotencyKey: `task-overdue-tick:${bucket}`,
          maxAttempts: 3,
        }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("overdue task tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
    try {
      // Production holds past the company's limit: per tick (each hold is told once).
      const { deduped: wasDeduped } = await withTenantClient(pool, organizationId, (client) =>
        enqueueJob(client, organizationId, {
          jobType: HOLD_OVERDUE_JOB_TYPE,
          idempotencyKey: `hold-overdue-tick:${bucket}`,
          maxAttempts: 3,
        }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("production hold overdue tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
    try {
      // Project due-date and health alerts: once a day (calendar-date key; each alert is sent once anyway).
      const { deduped: wasDeduped } = await withTenantClient(pool, organizationId, (client) =>
        enqueueJob(client, organizationId, {
          jobType: PROJECT_ALERTS_JOB_TYPE,
          idempotencyKey: `project-alerts:${snapshotDay}`,
          payload: { date: snapshotDay },
          maxAttempts: 3,
        }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("project alerts tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
    try {
      // Automatic depreciation accounting: once a day (calendar-date key). The month it processes is decided by the Company's policy and
      // Finance's calendar, and claimed once per book and month, so daily ticks never prepare or post twice.
      const { deduped: wasDeduped } = await withTenantClient(pool, organizationId, (client) =>
        enqueueJob(client, organizationId, {
          jobType: DEPRECIATION_AUTOMATION_JOB_TYPE,
          idempotencyKey: `depreciation-automation:${snapshotDay}`,
          payload: { date: snapshotDay },
          maxAttempts: 3,
        }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("depreciation automation tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
    try {
      // Asset maintenance: once a day (calendar-date key) — due preventive services become Work Orders once each, then overdue work is notified.
      const { deduped: wasDeduped } = await withTenantClient(pool, organizationId, (client) =>
        enqueueJob(client, organizationId, {
          jobType: MAINTENANCE_SCHEDULE_JOB_TYPE,
          idempotencyKey: `asset-maintenance:${snapshotDay}`,
          payload: { date: snapshotDay },
          maxAttempts: 3,
        }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("asset maintenance tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
  }
  logger.info("scheduler tick complete", { organizations: organizationIds.length, enqueued, deduped, bucket });
  return { organizations: organizationIds.length, enqueued, deduped };
}
