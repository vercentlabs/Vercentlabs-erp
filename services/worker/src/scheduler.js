import { createLogger } from "@vercentlabs/observability";

import { enqueueJob } from "./queue.js";
import { withTenantClient, listActiveOrganizationIds } from "./db.js";
import { JOB_TYPE as OVERDUE_ACTIVITY_JOB_TYPE } from "./handlers/crm-automation-overdue.js";
import { JOB_TYPE as LEAD_SLA_SCAN_JOB_TYPE } from "./handlers/crm-lead-sla-scan.js";
import { JOB_TYPE as LEAD_DWELL_SCAN_JOB_TYPE } from "./handlers/crm-lead-stage-dwell-scan.js";
import { JOB_TYPE as QUOTATION_EXPIRY_SCAN_JOB_TYPE } from "./handlers/sales-quotation-expiry-scan.js";
import { JOB_TYPE as PIPELINE_SNAPSHOT_CAPTURE_JOB_TYPE } from "./handlers/crm-pipeline-snapshot-capture.js";
import { JOB_TYPE as FOLLOW_UP_REMINDER_DISPATCH_JOB_TYPE } from "./handlers/crm-follow-up-reminder-dispatch.js";
import { JOB_TYPE as NURTURE_QUEUE_DISPATCH_JOB_TYPE } from "./handlers/crm-nurture-queue-dispatch.js";

const logger = createLogger("worker-scheduler");

// Scheduled sources: the activity.overdue detection tick, the Lead SLA
// breach/reassignment scan (F005/F014 gap-closing — see
// crm-lead-sla-scan.js for why this one specifically needed automating: the
// domain logic already existed and was correct, it just only ever ran when
// a human clicked "Scan now"), the Sales quotation-expiry scan
// (F038 gap-closing — see sales-quotation-expiry-scan.js; unlike the Lead
// SLA case, the domain logic itself didn't exist yet either), the Lead
// stage-dwell scan, and the F010 daily pipeline-snapshot capture (see
// crm-pipeline-snapshot-capture.js — uses a calendar-date idempotency key,
// `snapshotDay` below, rather than `bucket`, since it must fire once a day
// rather than once per tick). Per Part 24
// ("if only event enum names exist with no schedule definition: do not
// invent a broad scheduler DSL"; crm_automation_rules has no
// schedule/cron/interval column at all, confirmed by direct schema
// inspection), neither of these is a generic per-rule scheduling grammar
// — both are one-off, system-level ticks on the same fixed interval.
//
// Duplicate-occurrence prevention across multiple scheduler instances
// (Part 54/58) reuses the SAME mechanism as ordinary job idempotency —
// no separate advisory-lock system was built. `bucket` is a deterministic
// function of wall-clock time and the configured tick interval, so two
// scheduler processes racing to enqueue for the same organization and the
// same bucket collide on tenant.background_jobs's
// UNIQUE(organization_id, idempotency_key) constraint; the loser's
// enqueueJob() call resolves to the winner's already-inserted row instead
// of creating a duplicate (see queue.js's enqueueJob doc comment).
export async function runSchedulerTick(pool, config) {
  const bucket = Math.floor(Date.now() / config.worker.schedulerTickMilliseconds);
  // F010 integrity closeout: the daily pipeline-snapshot baseline uses a
  // calendar-date idempotency key (UTC) rather than `bucket` — the tick may
  // fire many times a day (schedulerTickMilliseconds is on the order of
  // minutes), but only the FIRST tick each day should actually enqueue the
  // capture job; every later tick that day dedupes against the same
  // tenant.background_jobs UNIQUE(organization_id, idempotency_key) row.
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
          jobType: LEAD_SLA_SCAN_JOB_TYPE,
          idempotencyKey: `lead-sla-scan-tick:${bucket}`,
          maxAttempts: 3,
        }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("lead SLA scan tick failed for organization", { organizationId, error: String(error?.message || error) });
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
      const { deduped: wasDeduped } = await withTenantClient(pool, organizationId, (client) =>
        enqueueJob(client, organizationId, {
          jobType: LEAD_DWELL_SCAN_JOB_TYPE,
          idempotencyKey: `lead-dwell-scan-tick:${bucket}`,
          maxAttempts: 3,
        }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("lead dwell scan tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
    try {
      const { deduped: wasDeduped } = await withTenantClient(pool, organizationId, (client) =>
        enqueueJob(client, organizationId, {
          jobType: PIPELINE_SNAPSHOT_CAPTURE_JOB_TYPE,
          idempotencyKey: `pipeline-snapshot-tick:${snapshotDay}`,
          maxAttempts: 3,
        }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("pipeline snapshot capture tick failed for organization", { organizationId, error: String(error?.message || error) });
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
      // CRM-VNEXT-052 closeout (nurture-queue half): same per-tick cadence
      // as the reminder dispatch above — claimDueNurtureQueueItems() only
      // claims rows whose due_at has actually passed, so an idle tick is
      // cheap and a no-op.
      const { deduped: wasDeduped } = await withTenantClient(pool, organizationId, (client) =>
        enqueueJob(client, organizationId, {
          jobType: NURTURE_QUEUE_DISPATCH_JOB_TYPE,
          idempotencyKey: `nurture-queue-dispatch-tick:${bucket}`,
          maxAttempts: 3,
        }),
      );
      if (wasDeduped) deduped += 1;
      else enqueued += 1;
    } catch (error) {
      logger.error("nurture queue dispatch tick failed for organization", { organizationId, error: String(error?.message || error) });
    }
  }
  logger.info("scheduler tick complete", { organizations: organizationIds.length, enqueued, deduped, bucket });
  return { organizations: organizationIds.length, enqueued, deduped };
}
