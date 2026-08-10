import assert from "node:assert/strict";
import test from "node:test";

import { enqueueJob, claimJobs, completeJob, failJob, QueueError } from "../src/queue.js";

const org = "11111111-1111-4111-8111-111111111111";

function mockClient(handlers) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [pattern, respond] of handlers) {
        if (pattern.test(sql)) return respond(params);
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("enqueueJob: a fresh job is inserted and returned with deduped=false", async () => {
  const client = mockClient([[/INSERT INTO tenant\.background_jobs/, () => ({ rows: [{ id: "job-1", job_type: "test.job" }] })]]);
  const { job, deduped } = await enqueueJob(client, org, { jobType: "test.job", idempotencyKey: "key-1" });
  assert.equal(job.id, "job-1");
  assert.equal(deduped, false);
});

test("enqueueJob: a colliding idempotency key resolves to the existing row instead of throwing or duplicating", async () => {
  const client = mockClient([
    [/INSERT INTO tenant\.background_jobs/, () => ({ rows: [] })], // ON CONFLICT DO NOTHING -> no row
    [/SELECT \* FROM tenant\.background_jobs WHERE organization_id/, () => ({ rows: [{ id: "existing-job", job_type: "test.job" }] })],
  ]);
  const { job, deduped } = await enqueueJob(client, org, { jobType: "test.job", idempotencyKey: "key-1" });
  assert.equal(job.id, "existing-job");
  assert.equal(deduped, true);
});

test("enqueueJob: requires a jobType", async () => {
  await assert.rejects(() => enqueueJob(mockClient([]), org, {}), QueueError);
});

test("claimJobs: requires a workerId", async () => {
  await assert.rejects(() => claimJobs(mockClient([]), org, { leaseMilliseconds: 1000 }), QueueError);
});

test("claimJobs: claim query selects pending-due OR expired-lease processing rows, FOR UPDATE SKIP LOCKED, scoped to the organization", async () => {
  const client = mockClient([
    [
      /UPDATE tenant\.background_jobs/,
      (params) => {
        assert.equal(params[0], org, "must be scoped to the caller's own organization");
        assert.equal(params[1], "worker-1");
        return { rows: [{ id: "job-1", status: "processing" }] };
      },
    ],
  ]);
  const rows = await claimJobs(client, org, { workerId: "worker-1", leaseMilliseconds: 60_000, batchSize: 5 });
  assert.equal(rows.length, 1);
  assert.match(client.calls[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(client.calls[0].sql, /status = 'pending' AND run_at <= now\(\)/);
  assert.match(client.calls[0].sql, /status = 'processing' AND lease_expires_at < now\(\)/);
});

test("completeJob: only completes a job still owned by the calling worker (locked_by match)", async () => {
  const client = mockClient([
    [
      /UPDATE tenant\.background_jobs\s+SET status = 'completed'/,
      (params) => {
        assert.equal(params[1], "worker-1");
        return { rows: [{ id: "job-1", status: "completed" }] };
      },
    ],
  ]);
  const result = await completeJob(client, "job-1", "worker-1");
  assert.equal(result.status, "completed");
  assert.match(client.calls[0].sql, /WHERE id = \$1 AND locked_by = \$2/);
});

test("failJob: retryable failure returns to pending with a future run_at; last_error is recorded", async () => {
  const client = mockClient([
    [
      /UPDATE tenant\.background_jobs\s+SET status = CASE/,
      (params) => {
        assert.equal(params[2], "boom");
        assert.equal(params[3], "60000");
        return { rows: [{ id: "job-1", status: "pending", last_error: "boom" }] };
      },
    ],
  ]);
  const result = await failJob(client, "job-1", "worker-1", { error: "boom", backoffMilliseconds: 60_000 });
  assert.equal(result.status, "pending");
  assert.match(client.calls[0].sql, /WHEN \$5 OR attempts >= max_attempts THEN 'dead' ELSE 'pending' END/);
});

test("failJob: dead=true forces immediate termination regardless of attempt count (a malformed payload will never become valid on retry)", async () => {
  const client = mockClient([
    [
      /UPDATE tenant\.background_jobs\s+SET status = CASE/,
      (params) => {
        assert.equal(params[4], true);
        return { rows: [{ id: "job-1", status: "dead" }] };
      },
    ],
  ]);
  const result = await failJob(client, "job-1", "worker-1", { error: "invalid payload", backoffMilliseconds: 60_000, dead: true });
  assert.equal(result.status, "dead");
});
