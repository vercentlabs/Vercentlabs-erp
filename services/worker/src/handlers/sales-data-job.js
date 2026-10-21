import { z } from "zod";
import { executeSalesDataJob, failSalesDataJob } from "@vercentlabs/api";

export const JOB_TYPE = "sales.data_job.run";

export const payloadSchema = z
  .object({
    salesDataJobId: z.string().uuid(),
  })
  .strict();

// A Sales import too large to run while the person waits (Line-by-line audit P5; managed mode: its own tenant transaction). The run
// re-checks the requester's CURRENT membership, permissions and Sales access, then does the same import the screens do with a larger
// row limit. A failed run is recorded in a separate transaction (the run's own is rolled back, so nothing is half done) and the person
// is told.
export async function salesDataJobHandler(_client, _systemContext, payload, runtime) {
  try {
    return await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) => executeSalesDataJob(client, runtime.organizationId, payload));
  } catch (error) {
    await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) => failSalesDataJob(client, runtime.organizationId, payload.salesDataJobId, error)).catch(() => undefined);
    throw error;
  }
}
