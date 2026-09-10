import { z } from "zod";
import {
  resolveOpportunityBulkExecutionContext,
  updateCrmRecord,
} from "@vercentlabs/api";
import { extendJobLease } from "../queue.js";

// F029 (Bulk actions) — LAST PROMPT 1/3 closeout: mirrors
// crm-lead-bulk-update.js exactly, substituting Opportunity for Lead. See
// services/api/src/modules/crm/opportunity-operations.js's
// enqueueOpportunityBulkUpdateJob for the enqueue side and
// normalizeOpportunityBulkChanges for the shared field/value validation both
// the synchronous (bulkUpdateOpportunities) and this asynchronous path use.

export const JOB_TYPE = "crm.opportunities.bulk_update";
export const BATCH_SIZE = 100;

export const payloadSchema = z
  .object({
    requesterUserId: z.string().uuid(),
    activeCompanyId: z.string().uuid().nullable(),
    activeBranchId: z.string().uuid().nullable(),
    commandFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    changes: z
      .object({
        ownerUserId: z.string().uuid().nullable().optional(),
        forecastCategory: z
          .enum(["omitted", "pipeline", "best_case", "committed", "closed"])
          .optional(),
        // crm_opportunities.expected_close_date is a plain `date` column
        // (not timestamptz) — matches normalizeOpportunityBulkChanges'
        // actual validation (any string Date.parse can handle), not the
        // stricter full-ISO-datetime-with-offset shape Leads' nextFollowUpAt
        // (a timestamptz column) uses.
        expectedCloseDate: z
          .string()
          .refine((value) => Number.isFinite(new Date(value).getTime()), "Invalid date")
          .nullable()
          .optional(),
        nextStep: z.string().max(2000).nullable().optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, "At least one Opportunity change is required."),
  })
  .strict();

function classifyItemError(error) {
  const status = Number(error?.status || 500);
  const code = String(error?.code || "CRM_OPPORTUNITY_BULK_ITEM_FAILED");
  if (status === 409 && (code.includes("STALE") || code.includes("VERSION") || code.includes("CONFLICT"))) {
    return {
      status: "conflict",
      code,
      message: "Opportunity changed after the bulk selection was snapshotted.",
    };
  }
  if (status === 403 || status === 404) {
    return {
      status: "skipped",
      code: "CRM_OPPORTUNITY_BULK_SCOPE_CHANGED",
      message: "Opportunity is no longer available in the requester's permitted scope.",
    };
  }
  return {
    status: "failed",
    code,
    message:
      status >= 500
        ? "Opportunity update failed with a retryable server error."
        : String(error?.message || "Opportunity update failed.").slice(0, 500),
  };
}

async function refreshManifest(client, organizationId, jobId) {
  const { rows } = await client.query(
    `SELECT
       count(*)::int AS requested,
       count(*) FILTER (WHERE status='pending')::int AS pending,
       count(*) FILTER (WHERE status='applied')::int AS applied,
       count(*) FILTER (WHERE status='conflict')::int AS conflict,
       count(*) FILTER (WHERE status='skipped')::int AS skipped,
       count(*) FILTER (WHERE status='failed')::int AS failed
     FROM tenant.crm_opportunity_bulk_job_items
     WHERE organization_id=$1 AND job_id=$2`,
    [organizationId, jobId],
  );
  const counts = rows[0] || {};
  const requested = Number(counts.requested || 0);
  const pending = Number(counts.pending || 0);
  const processed = Math.max(0, requested - pending);
  const manifest = {
    requested,
    processed,
    pending,
    applied: Number(counts.applied || 0),
    conflict: Number(counts.conflict || 0),
    skipped: Number(counts.skipped || 0),
    failed: Number(counts.failed || 0),
    percent: requested ? Math.min(100, Math.round((processed / requested) * 100)) : 100,
  };
  await client.query(
    `UPDATE tenant.background_jobs
        SET progress=$3::jsonb,result_manifest=$3::jsonb,updated_at=now()
      WHERE organization_id=$1 AND id=$2`,
    [organizationId, jobId, JSON.stringify(manifest)],
  );
  return manifest;
}

async function processBatch(client, context, payload, runtime) {
  await extendJobLease(client, runtime.job.id, runtime.workerId, runtime.leaseMilliseconds);

  const userContext = await resolveOpportunityBulkExecutionContext(
    client,
    runtime.organizationId,
    payload,
  );
  if (!userContext) {
    await client.query(
      `UPDATE tenant.crm_opportunity_bulk_job_items
          SET status='skipped',error_code='CRM_OPPORTUNITY_BULK_AUTH_REVOKED',
              error_message='Bulk Opportunity authorization is no longer valid.',processed_at=now()
        WHERE organization_id=$1 AND job_id=$2 AND status='pending'`,
      [runtime.organizationId, runtime.job.id],
    );
    return { done: true, manifest: await refreshManifest(client, runtime.organizationId, runtime.job.id) };
  }

  const pending = await client.query(
    `SELECT id,opportunity_id,expected_updated_at
       FROM tenant.crm_opportunity_bulk_job_items
      WHERE organization_id=$1 AND job_id=$2 AND status='pending'
      ORDER BY opportunity_id
      LIMIT $3
      FOR UPDATE SKIP LOCKED`,
    [runtime.organizationId, runtime.job.id, BATCH_SIZE],
  );

  if (!pending.rows.length) {
    const manifest = await refreshManifest(client, runtime.organizationId, runtime.job.id);
    if (manifest.pending > 0) {
      throw new Error("Opportunity bulk job still has pending items that are locked by another execution.");
    }
    return { done: true, manifest };
  }

  for (const item of pending.rows) {
    await client.query("SAVEPOINT crm_opportunity_bulk_worker_item");
    try {
      await updateCrmRecord(client, userContext, "opportunities", item.opportunity_id, payload.changes, {
        expectedUpdatedAt: new Date(item.expected_updated_at).toISOString(),
        requireVersion: true,
      });
      await client.query("RELEASE SAVEPOINT crm_opportunity_bulk_worker_item");
      await client.query(
        `UPDATE tenant.crm_opportunity_bulk_job_items
            SET status='applied',error_code=NULL,error_message=NULL,processed_at=now()
          WHERE organization_id=$1 AND id=$2`,
        [runtime.organizationId, item.id],
      );
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT crm_opportunity_bulk_worker_item");
      await client.query("RELEASE SAVEPOINT crm_opportunity_bulk_worker_item");
      const outcome = classifyItemError(error);
      await client.query(
        `UPDATE tenant.crm_opportunity_bulk_job_items
            SET status=$3,error_code=$4,error_message=$5,processed_at=now()
          WHERE organization_id=$1 AND id=$2`,
        [runtime.organizationId, item.id, outcome.status, outcome.code, outcome.message],
      );
    }
  }

  const manifest = await refreshManifest(client, runtime.organizationId, runtime.job.id);
  return { done: manifest.pending === 0, manifest };
}

// Managed transaction mode is intentional: one background job may represent
// tens of thousands of Opportunities, so each 100-record batch commits
// independently. Item outcome + progress are committed in the same
// transaction as the Opportunity mutations, making retries resume from
// durable pending items without replaying already-applied batches.
export async function opportunityBulkUpdateHandler(_client, _systemContext, payload, runtime) {
  for (;;) {
    const result = await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
      processBatch(client, _systemContext, payload, runtime),
    );
    if (result.done) return result.manifest;
  }
}
