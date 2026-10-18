import { z } from "zod";
import { executeCrmDataJob, failCrmDataJob } from "@vercentlabs/api/crm";

export const JOB_TYPE = "crm.data_job.run";

export const payloadSchema = z
  .object({
    crmDataJobId: z.string().uuid(),
  })
  .strict();

// A CRM import or export too large to run while the person waits (managed mode: its own tenant transaction). The run re-checks the
// requester's CURRENT membership, permissions and CRM access, then does the same import or export the screens do, with larger limits,
// and stores what it produced as an expiring Shared Platform file. A failed run is recorded on crm_data_jobs in a separate transaction
// (the run's own is rolled back, so an import leaves nothing half done) and the person is told.
export async function crmDataJobHandler(_client, _systemContext, payload, runtime) {
  try {
    return await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) => executeCrmDataJob(client, runtime.organizationId, payload));
  } catch (error) {
    await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) => failCrmDataJob(client, runtime.organizationId, payload.crmDataJobId, error)).catch(() => undefined);
    throw error;
  }
}
