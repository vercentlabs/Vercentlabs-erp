import { z } from "zod";
import {
  resolveLeadBulkExecutionContext,
  updateCrmRecord,
} from "@vercentlabs/api";
import { extendJobLease } from "../queue.js";

export const JOB_TYPE = "crm.leads.bulk_update";
export const BATCH_SIZE = 100;

export const payloadSchema = z
  .object({
    requesterUserId: z.string().uuid(),
    activeCompanyId: z.string().uuid().nullable(),
    activeBranchId: z.string().uuid().nullable(),
    commandFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    changes: z
      .object({
        sourceId: z.string().uuid().nullable().optional(),
        nextFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
        rating: z.enum(["cold", "warm", "hot"]).optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, "At least one Lead change is required."),
  })
  .strict();

function classifyItemError(error) {
  const status = Number(error?.status || 500);
  const code = String(error?.code || "CRM_LEAD_BULK_ITEM_FAILED");
  if (status === 409 && (code.includes("STALE") || code.includes("VERSION") || code.includes("CONFLICT"))) {
    return {
      status: "conflict",
      code,
      message: "Lead changed after the bulk selection was snapshotted.",
    };
  }
  if (status === 403 || status === 404) {
    return {
      status: "skipped",
      code: "CRM_LEAD_BULK_SCOPE_CHANGED",
      message: "Lead is no longer available in the requester's permitted scope.",
    };
  }
  return {
    status: "failed",
    code,
    message:
      status >= 500
        ? "Lead update failed with a retryable server error."
        : String(error?.message || "Lead update failed.").slice(0, 500),
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
     FROM tenant.crm_lead_bulk_job_items
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

  const userContext = await resolveLeadBulkExecutionContext(
    client,
    runtime.organizationId,
    payload,
  );
  if (!userContext) {
    await client.query(
      `UPDATE tenant.crm_lead_bulk_job_items
          SET status='skipped',error_code='CRM_LEAD_BULK_AUTH_REVOKED',
              error_message='Bulk Lead authorization is no longer valid.',processed_at=now()
        WHERE organization_id=$1 AND job_id=$2 AND status='pending'`,
      [runtime.organizationId, runtime.job.id],
    );
    return { done: true, manifest: await refreshManifest(client, runtime.organizationId, runtime.job.id) };
  }

  const pending = await client.query(
    `SELECT id,lead_id,expected_updated_at
       FROM tenant.crm_lead_bulk_job_items
      WHERE organization_id=$1 AND job_id=$2 AND status='pending'
      ORDER BY lead_id
      LIMIT $3
      FOR UPDATE SKIP LOCKED`,
    [runtime.organizationId, runtime.job.id, BATCH_SIZE],
  );

  if (!pending.rows.length) {
    const manifest = await refreshManifest(client, runtime.organizationId, runtime.job.id);
    if (manifest.pending > 0) {
      throw new Error("Lead bulk job still has pending items that are locked by another execution.");
    }
    return { done: true, manifest };
  }

  for (const item of pending.rows) {
    await client.query("SAVEPOINT crm_lead_bulk_worker_item");
    try {
      await updateCrmRecord(client, userContext, "leads", item.lead_id, payload.changes, {
        expectedUpdatedAt: new Date(item.expected_updated_at).toISOString(),
        requireVersion: true,
      });
      await client.query("RELEASE SAVEPOINT crm_lead_bulk_worker_item");
      await client.query(
        `UPDATE tenant.crm_lead_bulk_job_items
            SET status='applied',error_code=NULL,error_message=NULL,processed_at=now()
          WHERE organization_id=$1 AND id=$2`,
        [runtime.organizationId, item.id],
      );
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT crm_lead_bulk_worker_item");
      await client.query("RELEASE SAVEPOINT crm_lead_bulk_worker_item");
      const outcome = classifyItemError(error);
      await client.query(
        `UPDATE tenant.crm_lead_bulk_job_items
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
// tens of thousands of Leads, so each 100-record batch commits independently.
// Item outcome + progress are committed in the same transaction as the Lead
// mutations, making retries resume from durable pending items without replaying
// already-applied batches.
export async function leadBulkUpdateHandler(_client, _systemContext, payload, runtime) {
  for (;;) {
    const result = await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
      processBatch(client, _systemContext, payload, runtime),
    );
    if (result.done) return result.manifest;
  }
}
