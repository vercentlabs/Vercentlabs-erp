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
import { JOB_TYPE as LEAD_CONNECTORS_POLL_JOB_TYPE } from "./handlers/crm-lead-connectors-poll.js";
import { JOB_TYPE as LEAD_RESPONSE_WATCH_JOB_TYPE } from "./handlers/crm-lead-response-watch.js";
import { JOB_TYPE as CALENDAR_SYNC_JOB_TYPE } from "./handlers/crm-calendar-sync.js";
import { JOB_TYPE as MAILINGS_SEND_JOB_TYPE } from "./handlers/crm-mailings-send.js";
import { hasCalendarConnections, hasDueMailings, listDueLeadConnectors } from "@vercentlabs/api/crm";

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
    try {
      // CRM campaign emails: per tick, only for an organization with one due or sending.
      const queued = await withTenantClient(pool, organizationId, async (client) => {
        if (!(await hasDueMailings(client, organizationId))) return null;
        return enqueueJob(client, organizationId, { jobType: MAILINGS_SEND_JOB_TYPE, idempotencyKey: `crm-mailings-send:${bucket}`, maxAttempts: 2 });
      });
      if (queued?.deduped) deduped += 1;
      else if (queued) enqueued += 1;
    } catch (error) {
      logger.error("campaign email tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
    try {
      // CRM calendar sync (Google / Outlook): per tick, only for an organization with a connected calendar.
      const queued = await withTenantClient(pool, organizationId, async (client) => {
        if (!(await hasCalendarConnections(client, organizationId))) return null;
        return enqueueJob(client, organizationId, { jobType: CALENDAR_SYNC_JOB_TYPE, idempotencyKey: `crm-calendar-sync:${bucket}`, maxAttempts: 2 });
      });
      if (queued?.deduped) deduped += 1;
      else if (queued) enqueued += 1;
    } catch (error) {
      logger.error("calendar sync tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
    try {
      // CRM response times, overdue escalation and the assignment re-run (per tick; each notice once, by its stamp).
      const { deduped: wasDeduped } = await withTenantClient(pool, organizationId, (client) =>
        enqueueJob(client, organizationId, { jobType: LEAD_RESPONSE_WATCH_JOB_TYPE, idempotencyKey: `crm-lead-response-watch:${bucket}`, maxAttempts: 3 }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("lead response watch tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
    try {
      // CRM lead connectors (IndiaMART, TradeIndia): per tick, and only for an organization with a connector due to be read.
      const queued = await withTenantClient(pool, organizationId, async (client) => {
        if (!(await listDueLeadConnectors(client, organizationId)).length) return null;
        return enqueueJob(client, organizationId, { jobType: LEAD_CONNECTORS_POLL_JOB_TYPE, idempotencyKey: `crm-lead-connectors-poll:${bucket}`, maxAttempts: 2 });
      });
      if (queued?.deduped) deduped += 1;
      else if (queued) enqueued += 1;
    } catch (error) {
      logger.error("lead connectors tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
  }
  logger.info("scheduler tick complete", { organizations: organizationIds.length, enqueued, deduped, bucket });
  return { organizations: organizationIds.length, enqueued, deduped };
}
