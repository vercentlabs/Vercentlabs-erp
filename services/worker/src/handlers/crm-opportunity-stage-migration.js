import { z } from "zod";
import { processOpportunityStageMigrationBatch, OPPORTUNITY_STAGE_MIGRATION_JOB_TYPE } from "@vercentlabs/api";
import { extendJobLease } from "../queue.js";

export const JOB_TYPE = OPPORTUNITY_STAGE_MIGRATION_JOB_TYPE;

export const payloadSchema = z
  .object({
    fromStageId: z.string().uuid(),
    toStageId: z.string().uuid(),
    requesterUserId: z.string().uuid(),
  })
  .strict();

// F012 safe stage deactivation is an org-wide governance action — it must
// move every affected Opportunity regardless of the triggering admin's own
// company/branch/owner scope, since the alternative is silently leaving
// out-of-scope Opportunities stranded on the very stage being retired. The
// crmSettingsManage gate already happened once, at enqueue time (the API
// route). Mirrors crm-lead-stage-migration.js's own reasoning exactly.
function migrationSystemContext(organizationId, payload) {
  return Object.freeze({
    organizationId,
    userId: payload.requesterUserId,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: ["crm.records.view_all", "crm.opportunities.manage", "crm.settings.manage"],
    roleSlugs: ["system_worker"],
  });
}

// Same managed-transaction-per-batch shape as leadStageMigrationHandler —
// one job may represent thousands of Opportunities, so each 100-record
// batch commits independently and a retried/resumed job continues from
// durable pending items rather than replaying already-migrated deals.
export async function opportunityStageMigrationHandler(_client, _systemContext, payload, runtime) {
  const context = migrationSystemContext(runtime.organizationId, payload);
  for (;;) {
    await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
      extendJobLease(client, runtime.job.id, runtime.workerId, runtime.leaseMilliseconds),
    );
    const result = await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
      processOpportunityStageMigrationBatch(client, context, runtime.job.id),
    );
    if (result.done) return result.manifest;
  }
}
