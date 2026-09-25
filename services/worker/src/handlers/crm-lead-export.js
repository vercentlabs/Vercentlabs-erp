import { z } from "zod";
import { buildCrmLeadExportCsv, completeCrmLeadExportJob, resolveLeadBulkExecutionContext } from "@vercentlabs/api";

export const JOB_TYPE = "crm.leads.export";

export const payloadSchema = z
  .object({
    requesterUserId: z.string().uuid(),
    activeCompanyId: z.string().uuid().nullable(),
    activeBranchId: z.string().uuid().nullable(),
    allowAllCompanies: z.boolean(),
    filters: z.record(z.string(), z.string()).optional().default({}),
  })
  .strict();

// F021 Stage A2 §9. Managed mode (like crm.leads.bulk_update) so the
// handler can open its own tenant client via runtime.withTenantClient and
// reach runtime.job.id — completeCrmLeadExportJob (lead-export.js) writes
// the real domain manifest (including the generated CSV) directly, so
// this handler deliberately returns nothing: the generic runner's own
// post-handler completeJob(job.id, workerId, {resultManifest: undefined})
// call then leaves progress/result_manifest exactly as
// completeCrmLeadExportJob already set them (see completeJob's own
// "resultManifest == null keeps the existing value" behavior), rather
// than overwriting the CSV with a second, different write.
//
// Re-resolves a fresh execution context (never trusting the requester's
// permissions as they were at enqueue time) via the SAME resolver
// crm.leads.bulk_update already uses — it already does exactly the
// re-validation an export needs: crm.export still held, company/
// branch access still current. Row generation and CSV formatting are
// entirely delegated to buildCrmLeadExportCsv, which itself calls
// listCrmRecords("leads", ...) — the SAME governed, scoped read the
// interactive Leads list uses. No parallel row-authorization logic here.
export async function leadExportHandler(_client, _systemContext, payload, runtime) {
  await runtime.withTenantClient(runtime.pool, runtime.organizationId, async (client) => {
    const context = await resolveLeadBulkExecutionContext(client, runtime.organizationId, payload, { requiredPermission: "crm.export" });
    // A genuine failure (permissions revoked, company/branch access
    // changed since enqueue), not a valid empty export — throwing lets
    // the generic job runner's retry/dead-letter path handle it, rather
    // than silently completing with a misleading "0 rows, success".
    if (!context) throw new Error("Export authorization is no longer valid for this requester.");
    const result = await buildCrmLeadExportCsv(client, context, payload.filters || {});
    await completeCrmLeadExportJob(client, runtime.job.id, runtime.organizationId, result);
  });
}
