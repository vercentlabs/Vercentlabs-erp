import { createLogger } from "@vercentlabs/observability";

import { enqueueJob } from "./queue.js";
import { withTenantClient, listActiveOrganizationIds } from "./db.js";
import { JOB_TYPE as OVERDUE_ACTIVITY_JOB_TYPE } from "./handlers/crm-automation-overdue.js";
import { JOB_TYPE as LEAD_SLA_SCAN_JOB_TYPE } from "./handlers/crm-lead-sla-scan.js";
import { JOB_TYPE as QUOTATION_EXPIRY_SCAN_JOB_TYPE } from "./handlers/sales-quotation-expiry-scan.js";

const logger = createLogger("worker-scheduler");

// Three scheduled sources exist today: the activity.overdue detection tick,
// the Lead SLA breach/reassignment scan (F005/F014 gap-closing — see
// crm-lead-sla-scan.js for why this one specifically needed automating: the
// domain logic already existed and was correct, it just only ever ran when
// a human clicked "Scan now"), and the Sales quotation-expiry scan
// (F038 gap-closing — see sales-quotation-expiry-scan.js; unlike the Lead
// SLA case, the domain logic itself didn't exist yet either). Per Part 24
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
  }
  logger.info("scheduler tick complete", { organizations: organizationIds.length, enqueued, deduped, bucket });
  return { organizations: organizationIds.length, enqueued, deduped };
}
