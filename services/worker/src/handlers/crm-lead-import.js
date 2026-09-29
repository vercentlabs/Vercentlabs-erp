import { z } from "zod";
import {
  finalizeLeadImport,
  processLeadImportChunk,
  resolveLeadBulkExecutionContext,
} from "@vercentlabs/api";
import { createLogger } from "@vercentlabs/observability";

import { extendJobLease } from "../queue.js";

export const JOB_TYPE = "crm.leads.import";

export const payloadSchema = z
  .object({
    batchId: z.string().uuid(),
    requesterUserId: z.string().uuid(),
    activeCompanyId: z.string().uuid().nullable(),
    activeBranchId: z.string().uuid().nullable(),
  })
  .strict();

const logger = createLogger("worker-crm-lead-import");

// F021 durable lead import. Managed transactions: each chunk (lead creation +
// "row processed" mark + batch counters) commits on its own, so a crash,
// restart or retry resumes at the next pending row and never imports a row
// twice. The requester's CURRENT authority is re-read for every chunk: a
// revoked import permission stops the import and marks the rest as refused.
export async function leadImportHandler(_client, _systemContext, payload, runtime) {
  const started = Date.now();
  const organizationId = runtime.organizationId;
  await runtime.withTenantClient(runtime.pool, organizationId, (client) =>
    client.query(
      `UPDATE tenant.crm_lead_import_batches SET status='processing', started_at=COALESCE(started_at, now()), updated_at=now()
        WHERE organization_id=$1 AND id=$2 AND status IN ('queued','processing')`,
      [organizationId, payload.batchId],
    ),
  );
  let chunks = 0;
  for (;;) {
    const result = await runtime.withTenantClient(runtime.pool, organizationId, async (client) => {
      if (runtime.job?.id && runtime.workerId) await extendJobLease(client, runtime.job.id, runtime.workerId, runtime.leaseMilliseconds);
      const batch = (await client.query(`SELECT status FROM tenant.crm_lead_import_batches WHERE organization_id=$1 AND id=$2`, [organizationId, payload.batchId])).rows[0];
      if (!batch || !["queued", "processing"].includes(batch.status)) return { done: true, batch: null, skipped: true };
      const context = await resolveLeadBulkExecutionContext(client, organizationId, payload, { requiredPermission: "crm.import" });
      const allowed = context && (context.roleSlugs.includes("organization_owner") || context.permissions.includes("crm.leads.manage"));
      if (!allowed) {
        await client.query(
          `UPDATE tenant.crm_lead_import_rows SET action='error', error_code='CRM_LEAD_IMPORT_AUTH_REVOKED',
                  validation_errors='[{"message":"The importer can no longer import leads."}]'::jsonb, processed_at=now()
            WHERE organization_id=$1 AND batch_id=$2 AND action='pending'`,
          [organizationId, payload.batchId],
        );
        const systemContext = { organizationId, userId: payload.requesterUserId };
        return { done: true, batch: await finalizeLeadImport(client, systemContext, payload.batchId, { failureReason: "The importer's permission was removed." }) };
      }
      const chunk = await processLeadImportChunk(client, context, payload.batchId);
      const progress = { remaining: chunk.remaining, processedInChunk: chunk.processed };
      if (runtime.job?.id)
        await client.query(`UPDATE tenant.background_jobs SET progress=$3::jsonb, updated_at=now() WHERE organization_id=$1 AND id=$2`, [organizationId, runtime.job.id, JSON.stringify(progress)]);
      if (chunk.remaining === 0 || chunk.processed === 0) return { done: true, batch: await finalizeLeadImport(client, context, payload.batchId) };
      return { done: false };
    });
    chunks += 1;
    if (result.done) {
      const batch = result.batch;
      logger.event("crm.lead_import", {
        organizationId,
        outcome: result.skipped ? "skipped" : batch?.status ?? "unknown",
        recordCount: batch ? Number(batch.processed_rows ?? 0) : 0,
        created: batch ? Number(batch.created_rows ?? 0) : 0,
        failed: batch ? Number(batch.failed_rows ?? 0) : 0,
        chunks,
        attempt: runtime.job?.attempts ?? null,
        durationMs: Date.now() - started,
      });
      return batch ? { status: batch.status, processed: batch.processed_rows, created: batch.created_rows, updated: batch.updated_rows, skipped: batch.skipped_rows, failed: batch.failed_rows } : { skipped: true };
    }
  }
}
