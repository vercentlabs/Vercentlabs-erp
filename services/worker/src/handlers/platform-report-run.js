import { z } from "zod";
import { executeReportRun, failReportRun } from "@vercentlabs/api";

export const JOB_TYPE = "platform.reports.run";

export const payloadSchema = z
  .object({
    reportRunId: z.string().uuid(),
    activeCompanyId: z.string().uuid().nullable(),
    activeBranchId: z.string().uuid().nullable(),
  })
  .strict();

// Shared reporting run (managed mode: its own tenant transaction). The run
// re-checks the requester's CURRENT membership, permissions, company/branch
// access, module enablement and entitlement before reading anything, then
// writes the CSV as an expiring Shared Platform file. A refused or failed run
// is recorded on report_runs (and the job retries/dead-letters as usual).
export async function reportRunHandler(_client, _systemContext, payload, runtime) {
  try {
    return await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) => executeReportRun(client, runtime.organizationId, payload));
  } catch (error) {
    await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) => failReportRun(client, runtime.organizationId, payload.reportRunId, error)).catch(() => undefined);
    throw error;
  }
}
