import { z } from "zod";
import { processLeadScoreRecalcBatch, SCORE_RECALC_JOB_TYPE } from "@vercentlabs/api";
import { extendJobLease } from "../queue.js";

export const JOB_TYPE = SCORE_RECALC_JOB_TYPE;

export const payloadSchema = z
  .object({
    modelId: z.string().uuid(),
    requesterUserId: z.string().uuid(),
  })
  .strict();

// F027 bulk recalculation: activating a new scoring model must not leave
// every existing Lead carrying a stale score/model_id. Same managed-
// transaction-per-batch shape as leadBulkUpdateHandler/leadStageMigrationHandler.
function recalcSystemContext(organizationId, payload) {
  return Object.freeze({
    organizationId,
    userId: payload.requesterUserId,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: ["crm.records.view_all", "crm.leads.view_sensitive"],
    roleSlugs: ["system_worker"],
  });
}

export async function leadScoreRecalcHandler(_client, _systemContext, payload, runtime) {
  const context = recalcSystemContext(runtime.organizationId, payload);
  for (;;) {
    await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
      extendJobLease(client, runtime.job.id, runtime.workerId, runtime.leaseMilliseconds),
    );
    const result = await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
      processLeadScoreRecalcBatch(client, context, runtime.job.id),
    );
    if (result.done) return result.manifest;
  }
}
