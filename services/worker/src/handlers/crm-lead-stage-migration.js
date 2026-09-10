import { z } from "zod";
import { processLeadStageMigrationBatch, STAGE_MIGRATION_JOB_TYPE } from "@vercentlabs/api";
import { extendJobLease } from "../queue.js";

export const JOB_TYPE = STAGE_MIGRATION_JOB_TYPE;

export const payloadSchema = z
  .object({
    fromStageId: z.string().uuid(),
    toStageId: z.string().uuid(),
    requesterUserId: z.string().uuid(),
  })
  .strict();

// Migration is an org-wide governance action (deactivating a stage) — it
// must move every affected Lead regardless of the triggering admin's own
// company/branch/owner scope, since the alternative is silently leaving
// out-of-scope Leads stranded on the very stage being retired. The
// crmSettingsManage + elevated-actor gate already happened once, at
// enqueue time (the API route). Mirrors crm-lead-sla-scan.js's own
// reasoning for building a dedicated elevated context here rather than
// widening the shared system context every other job uses.
function migrationSystemContext(organizationId, payload) {
  return Object.freeze({
    organizationId,
    userId: payload.requesterUserId,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: ["crm.records.view_all", "crm.leads.manage", "crm.settings.manage"],
    roleSlugs: ["system_worker"],
  });
}

// F007 safe stage deactivation: migrating Leads off a retired stage. Same
// managed-transaction-per-batch shape as leadBulkUpdateHandler — one job
// may represent thousands of Leads, so each 100-record batch commits
// independently and a retried/resumed job continues from durable pending
// items rather than replaying already-migrated Leads.
export async function leadStageMigrationHandler(_client, _systemContext, payload, runtime) {
  const context = migrationSystemContext(runtime.organizationId, payload);
  for (;;) {
    await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
      extendJobLease(client, runtime.job.id, runtime.workerId, runtime.leaseMilliseconds),
    );
    const result = await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
      processLeadStageMigrationBatch(client, context, runtime.job.id),
    );
    if (result.done) return result.manifest;
  }
}
