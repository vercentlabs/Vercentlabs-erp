import { z } from "zod";
import { processDuplicateFullScanBatch, DUPLICATE_FULL_SCAN_JOB_TYPE } from "@vercentlabs/api";
import { extendJobLease } from "../queue.js";

export const JOB_TYPE = DUPLICATE_FULL_SCAN_JOB_TYPE;

export const payloadSchema = z
  .object({
    entityType: z.enum(["lead", "contact", "account"]),
    requesterUserId: z.string().uuid(),
  })
  .strict();

// A full duplicate scan is a read-mostly discovery job (it only ever
// inserts into the append-only crm_duplicate_scan_matches log), but it
// still needs org-wide visibility to page through every record regardless
// of the requester's own company/branch/owner scope — same reasoning as
// leadStageMigrationHandler for building a dedicated elevated context here.
function scanSystemContext(organizationId, payload) {
  return Object.freeze({
    organizationId,
    userId: payload.requesterUserId,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: ["crm.records.view_all", "crm.data-quality.manage"],
    roleSlugs: ["system_worker"],
  });
}

// F008 full-dataset duplicate scan. Same "keep calling until done" shape as
// leadStageMigrationHandler: each call pages through one batch of records,
// re-runs the SAME governed matching engine per record, and persists
// progress in tenant.background_jobs so a resumed/retried job continues
// from its last keyset position rather than re-scanning from the start.
export async function duplicateFullScanHandler(_client, _systemContext, payload, runtime) {
  const context = scanSystemContext(runtime.organizationId, payload);
  for (;;) {
    await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
      extendJobLease(client, runtime.job.id, runtime.workerId, runtime.leaseMilliseconds),
    );
    const result = await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
      processDuplicateFullScanBatch(client, context, runtime.job.id),
    );
    if (result.done) return result.manifest;
  }
}
