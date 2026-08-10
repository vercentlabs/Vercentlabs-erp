import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import { processGenericJob } from "../src/worker.js";
import { registerJobHandler, _resetRegistryForTests } from "../src/registry.js";
import { internalJobBackoff } from "../src/backoff.js";

const org = "11111111-1111-4111-8111-111111111111";

function fakePool(clientQuery) {
  return {
    async connect() {
      return {
        async query(sql, params) {
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return {};
          if (/SELECT set_config/.test(sql)) return {};
          return clientQuery(sql, params);
        },
        release() {},
      };
    },
  };
}

test("processGenericJob: an unknown job type fails safely instead of crashing the worker loop (Part 6)", async () => {
  _resetRegistryForTests();
  const calls = [];
  const pool = fakePool((sql, params) => {
    calls.push({ sql, params });
    if (/UPDATE tenant\.background_jobs\s+SET status = CASE/.test(sql)) return { rows: [{ id: "job-1", status: "pending" }] };
    throw new Error(`unexpected: ${sql}`);
  });
  await processGenericJob(pool, "worker-1", org, { id: "job-1", job_type: "unknown.job.type", payload: {}, attempts: 1 });
  const failCall = calls.find((call) => /SET status = CASE/.test(call.sql));
  assert.ok(failCall, "must record a failure, not throw uncaught");
  assert.match(failCall.params[2], /No handler registered/);
});

test("processGenericJob: a malformed payload is forced dead immediately, not retried up to max_attempts", async () => {
  _resetRegistryForTests();
  registerJobHandler("test.strict", { schema: z.object({ x: z.number() }).strict(), handler: async () => {}, backoff: internalJobBackoff });
  const calls = [];
  const pool = fakePool((sql, params) => {
    calls.push({ sql, params });
    if (/UPDATE tenant\.background_jobs\s+SET status = CASE/.test(sql)) return { rows: [{ id: "job-1", status: "dead" }] };
    throw new Error(`unexpected: ${sql}`);
  });
  await processGenericJob(pool, "worker-1", org, { id: "job-1", job_type: "test.strict", payload: { x: "not a number" }, attempts: 1 });
  const failCall = calls.find((call) => /SET status = CASE/.test(call.sql));
  assert.ok(failCall);
  assert.equal(failCall.params[4], true, "dead must be forced true for a validation failure");
});

test("processGenericJob: a handler that throws is recorded as a retryable failure using the handler's own backoff policy", async () => {
  _resetRegistryForTests();
  let backoffCalledWith = null;
  registerJobHandler("test.flaky", {
    handler: async () => {
      throw new Error("transient failure");
    },
    backoff: (attempt) => {
      backoffCalledWith = attempt;
      return 12_345;
    },
  });
  const calls = [];
  const pool = fakePool((sql, params) => {
    calls.push({ sql, params });
    if (/UPDATE tenant\.background_jobs\s+SET status = CASE/.test(sql)) return { rows: [{ id: "job-1", status: "pending" }] };
    throw new Error(`unexpected: ${sql}`);
  });
  await processGenericJob(pool, "worker-1", org, { id: "job-1", job_type: "test.flaky", payload: {}, attempts: 2 });
  assert.equal(backoffCalledWith, 2);
  const failCall = calls.find((call) => /SET status = CASE/.test(call.sql));
  assert.equal(failCall.params[3], "12345");
});

test("processGenericJob: a successful handler run completes the job and its own DB writes atomically (same transaction)", async () => {
  _resetRegistryForTests();
  let handlerRan = false;
  registerJobHandler("test.ok", {
    handler: async () => {
      handlerRan = true;
      return { done: true };
    },
    backoff: internalJobBackoff,
  });
  const calls = [];
  const pool = fakePool((sql, params) => {
    calls.push({ sql, params });
    if (/UPDATE tenant\.background_jobs\s+SET status = 'completed'/.test(sql)) return { rows: [{ id: "job-1", status: "completed" }] };
    throw new Error(`unexpected: ${sql}`);
  });
  await processGenericJob(pool, "worker-1", org, { id: "job-1", job_type: "test.ok", payload: {}, attempts: 1 });
  assert.ok(handlerRan);
  assert.ok(calls.some((call) => /SET status = 'completed'/.test(call.sql)));
});
