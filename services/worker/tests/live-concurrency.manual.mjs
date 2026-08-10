#!/usr/bin/env node
// MANUAL, live-PostgreSQL-only test — deliberately named *.manual.mjs so
// it is NOT matched by `services/worker`'s `test` script glob
// (tests/*.test.mjs) and is therefore never a dependency of `pnpm
// test:worker`/`pnpm verify`, exactly matching this repository's
// established precedent (Prompt 2 onward: routine `pnpm verify` never
// requires a live database; live verification is a deliberate, separate,
// manually-run step — see docs/implementation/
// ERP_VERIFICATION_BASELINE_002.md Section 9).
//
// Proves, against a real running Postgres, the two properties Part
// 59/60/64 explicitly say cannot be proven by static/mocked tests alone:
//   1. two concurrent "workers" claiming from the same queue never claim
//      the same job (FOR UPDATE SKIP LOCKED genuinely works);
//   2. a job whose lease has expired (simulating a crashed worker) is
//      safely reclaimed by a different worker, exactly once.
//
// Run manually: node services/worker/tests/live-concurrency.manual.mjs
// Requires DATABASE_URL pointed at a real Postgres with migration 052
// applied. Creates and then deletes its own rows; touches no other data.
import pg from "pg";
import { setTenantContext } from "@vercentlabs/database";
import { claimJobs, enqueueJob } from "../src/queue.js";

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://vercentlabs:vercentlabs_local_password@localhost:5433/vercentlabs_control";
const PROBE_JOB_TYPE = "test.manual_concurrency_probe";

let failures = 0;
function check(condition, message) {
  if (condition) {
    console.log(`OK   ${message}`);
  } else {
    failures += 1;
    console.error(`FAIL ${message}`);
  }
}

async function withClient(pool, organizationId, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setTenantContext(client, organizationId);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

  const { rows: orgRows } = await pool.query("SELECT id FROM organizations LIMIT 1");
  if (!orgRows[0]) throw new Error("No organizations found in this database — cannot run the live concurrency probe.");
  const organizationId = orgRows[0].id;
  console.log(`Using organization ${organizationId}`);

  // --- Test 1: two concurrent claims never overlap ---
  const jobCount = 20;
  for (let index = 0; index < jobCount; index += 1) {
    await withClient(pool, organizationId, (client) =>
      enqueueJob(client, organizationId, {
        jobType: PROBE_JOB_TYPE,
        idempotencyKey: `manual-probe:${Date.now()}:${index}:${Math.random()}`,
        maxAttempts: 5,
      }),
    );
  }

  const [claimedByA, claimedByB] = await Promise.all([
    withClient(pool, organizationId, (client) => claimJobs(client, organizationId, { workerId: "manual-worker-A", leaseMilliseconds: 60_000, batchSize: 15 })),
    withClient(pool, organizationId, (client) => claimJobs(client, organizationId, { workerId: "manual-worker-B", leaseMilliseconds: 60_000, batchSize: 15 })),
  ]);
  const idsA = new Set(claimedByA.map((job) => job.id));
  const idsB = new Set(claimedByB.map((job) => job.id));
  const overlap = [...idsA].filter((id) => idsB.has(id));
  check(overlap.length === 0, `no job claimed by both concurrent workers (A claimed ${idsA.size}, B claimed ${idsB.size}, overlap ${overlap.length})`);
  check(idsA.size + idsB.size <= jobCount, `total claimed (${idsA.size + idsB.size}) never exceeds the number enqueued (${jobCount})`);
  check(idsA.size + idsB.size === jobCount, `every enqueued job was claimed by exactly one worker (FOR UPDATE SKIP LOCKED did not stall/skip real availability)`);

  // Release everything claimed by A/B so cleanup can delete them below (they're 'processing' with a lease).
  const allClaimedIds = [...idsA, ...idsB];

  // --- Test 2: lease expiry allows a different worker to reclaim ---
  const [reclaimTarget] = await withClient(pool, organizationId, (client) =>
    enqueueJob(client, organizationId, { jobType: PROBE_JOB_TYPE, idempotencyKey: `manual-probe-reclaim:${Date.now()}`, maxAttempts: 5 }),
  ).then((r) => [r.job]);
  const firstClaim = await withClient(pool, organizationId, (client) =>
    claimJobs(client, organizationId, { workerId: "manual-worker-crashed", leaseMilliseconds: 200, batchSize: 10 }),
  );
  const claimedTarget = firstClaim.find((job) => job.id === reclaimTarget.id);
  check(Boolean(claimedTarget), "the reclaim-test job was claimed by the first ('crashing') worker");

  await new Promise((resolve) => setTimeout(resolve, 400)); // wait past the 200ms lease

  const secondClaim = await withClient(pool, organizationId, (client) =>
    claimJobs(client, organizationId, { workerId: "manual-worker-rescuer", leaseMilliseconds: 60_000, batchSize: 10 }),
  );
  const reclaimed = secondClaim.find((job) => job.id === reclaimTarget.id);
  check(Boolean(reclaimed), "a job whose lease expired (simulating a crashed worker) was reclaimed by a different worker");
  check(reclaimed?.locked_by === "manual-worker-rescuer", "the reclaimed job is now owned by the rescuing worker, not the crashed one");
  check(reclaimed?.attempts === 2, `attempts incremented across the crash+reclaim (expected 2, got ${reclaimed?.attempts})`);

  // --- Cleanup: delete every row this probe created ---
  await withClient(pool, organizationId, (client) =>
    client.query("DELETE FROM tenant.background_jobs WHERE organization_id = $1 AND job_type = $2", [organizationId, PROBE_JOB_TYPE]),
  );
  console.log("Cleanup complete — all probe rows deleted.");

  await pool.end();
  console.log(failures === 0 ? "\nALL LIVE CONCURRENCY CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Live concurrency probe crashed:", error);
  process.exit(1);
});
