import assert from "node:assert/strict";
import test from "node:test";

import { listBackgroundJobs, getBackgroundJob, BackgroundJobError } from "../src/core/background-jobs.js";

test("listBackgroundJobs rejects an unsupported status filter rather than silently returning everything", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    listBackgroundJobs(client, "org-1", { status: "not-a-real-status" }),
    (error) => error instanceof BackgroundJobError && error.status === 400,
  );
});

test("listBackgroundJobs scopes to tenant.background_jobs by organization", async () => {
  let capturedSql, capturedValues;
  const client = { query: async (sql, values) => { capturedSql = sql; capturedValues = values; return { rows: [] }; } };
  await listBackgroundJobs(client, "org-1", { status: "processing" });
  assert.match(capturedSql, /tenant\.background_jobs/);
  assert.deepEqual(capturedValues, ["org-1", "processing", 100]);
});

test("getBackgroundJob 404s for a job outside this organization", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    getBackgroundJob(client, "org-1", "not-mine"),
    (error) => error instanceof BackgroundJobError && error.status === 404,
  );
});
