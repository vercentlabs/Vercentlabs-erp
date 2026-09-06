import assert from "node:assert/strict";
import test from "node:test";

import { runSchedulerTick } from "../src/scheduler.js";

const org1 = "11111111-1111-4111-8111-111111111111";
const org2 = "22222222-2222-4222-8222-222222222222";

function fakePool({ existingJobs = new Map() } = {}) {
  return {
    async query(sql) {
      if (/SELECT id FROM organizations/.test(sql)) return { rows: [{ id: org1 }, { id: org2 }] };
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, params) {
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return {};
          if (/SELECT set_config/.test(sql)) return {};
          if (/INSERT INTO tenant\.background_jobs/.test(sql)) {
            const organizationId = params[0];
            const idempotencyKey = params[6];
            const dedupeKey = `${organizationId}:${idempotencyKey}`;
            if (existingJobs.has(dedupeKey)) return { rows: [] }; // ON CONFLICT DO NOTHING
            const job = { id: `job-${existingJobs.size + 1}`, organization_id: organizationId, idempotency_key: idempotencyKey };
            existingJobs.set(dedupeKey, job);
            return { rows: [job] };
          }
          if (/SELECT \* FROM tenant\.background_jobs WHERE organization_id/.test(sql)) {
            const dedupeKey = `${params[0]}:${params[1]}`;
            return { rows: [existingJobs.get(dedupeKey)] };
          }
          throw new Error(`Unexpected client query: ${sql}`);
        },
        release() {},
      };
    },
  };
}

test("runSchedulerTick: enqueues one overdue-detection job and one Lead SLA scan job per active organization", async () => {
  const pool = fakePool();
  const result = await runSchedulerTick(pool, { worker: { schedulerTickMilliseconds: 300_000 } });
  assert.equal(result.organizations, 2);
  assert.equal(result.enqueued, 4); // 2 organizations x 2 scheduled job types
  assert.equal(result.deduped, 0);
});

test("runSchedulerTick: two scheduler instances racing for the same tick bucket do not double-enqueue (Part 58)", async () => {
  const existingJobs = new Map();
  const pool = fakePool({ existingJobs });
  const config = { worker: { schedulerTickMilliseconds: 300_000 } };

  const first = await runSchedulerTick(pool, config);
  const second = await runSchedulerTick(pool, config);

  assert.equal(first.enqueued, 4);
  assert.equal(second.enqueued, 0, "the second concurrent tick within the same time bucket must not create new jobs");
  assert.equal(second.deduped, 4, "the second tick must resolve to the already-enqueued jobs instead");
});

test("runSchedulerTick: a failure enqueuing for one organization does not prevent enqueueing for the others", async () => {
  let calls = 0;
  const pool = {
    async query(sql) {
      if (/SELECT id FROM organizations/.test(sql)) return { rows: [{ id: org1 }, { id: org2 }] };
      throw new Error("unexpected");
    },
    async connect() {
      calls += 1;
      // org1's two scheduled job types are both enqueued via the first two
      // connect() calls; failing both simulates the whole organization's
      // enqueue attempt failing, distinct from org2's which must still succeed.
      const shouldFail = calls <= 2;
      return {
        async query(sql) {
          if (sql === "BEGIN") return {};
          if (sql === "COMMIT") return {};
          if (sql === "ROLLBACK") return {};
          if (/SELECT set_config/.test(sql)) return {};
          if (/INSERT INTO tenant\.background_jobs/.test(sql)) {
            if (shouldFail) throw new Error("simulated DB error for org1");
            return { rows: [{ id: "job-x" }] };
          }
          throw new Error("unexpected");
        },
        release() {},
      };
    },
  };
  const result = await runSchedulerTick(pool, { worker: { schedulerTickMilliseconds: 300_000 } });
  assert.equal(result.organizations, 2);
  assert.equal(result.enqueued, 2, "org2's two scheduled jobs must still be enqueued even though org1's failed");
});
