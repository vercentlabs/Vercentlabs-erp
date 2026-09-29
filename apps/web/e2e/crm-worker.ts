import pg from "pg";

// @ts-expect-error -- plain JS worker modules without declaration files
import { registerBuiltinHandlers } from "../../../services/worker/src/handlers/index.js";
// @ts-expect-error -- plain JS worker modules without declaration files
import { claimJobs } from "../../../services/worker/src/queue.js";
// @ts-expect-error -- plain JS worker modules without declaration files
import { processGenericJob } from "../../../services/worker/src/worker.js";
import { setTenantContext } from "../../../packages/database/src/index.js";

// The CRM journeys that hand work to the background (large lead imports,
// report runs) are completed by the REAL worker code: jobs are claimed with
// the worker's own claimJobs and run through processGenericJob with the
// registered handlers, exactly as the worker process does — only the loop
// that would poll for them is replaced by this call.
let registered = false;
const pool = new pg.Pool({
  connectionString:
    process.env.WORKER_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.MIGRATION_DATABASE_URL,
  max: 3,
});

export async function runWorkerJobs(
  organizationId: string,
  jobTypes: string[],
  { rounds = 5 } = {},
): Promise<number> {
  if (!registered) {
    registerBuiltinHandlers();
    registered = true;
  }
  const workerId = `e2e-crm-${process.pid}`;
  let processed = 0;
  for (let round = 0; round < rounds; round += 1) {
    const client = await pool.connect();
    let jobs: Array<{ job_type: string }> = [];
    try {
      await client.query("BEGIN");
      await setTenantContext(client, organizationId);
      jobs = await claimJobs(client, organizationId, {
        workerId,
        leaseMilliseconds: 120_000,
        batchSize: 10,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    // Jobs of other types claimed in the same batch are processed too (the
    // real worker would do the same); the caller only waits for its own.
    for (const job of jobs)
      await processGenericJob(pool, workerId, organizationId, job, {
        leaseMilliseconds: 120_000,
      });
    processed += jobs.filter((job) => jobTypes.includes(job.job_type)).length;
    if (!jobs.length) break;
  }
  return processed;
}
