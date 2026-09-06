import assert from "node:assert/strict";
import test from "node:test";

import {
  LEAD_BULK_JOB_TYPE,
  cancelLeadBulkJob,
  retryFailedLeadBulkJobItems,
} from "../src/modules/crm/lead-operations.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const otherUser = "33333333-3333-4333-8333-333333333333";
const jobId = "44444444-4444-4444-8444-444444444444";

const repContext = {
  organizationId: org,
  userId: user,
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: [],
  permissions: ["crm.view", "crm.leads.manage"],
};
const managerContext = { ...repContext, permissions: [...repContext.permissions, "crm.records.view_all"] };

function jobRow(overrides = {}) {
  return {
    id: jobId,
    organization_id: org,
    job_type: LEAD_BULK_JOB_TYPE,
    status: "processing",
    requested_by: user,
    attempts: 1,
    max_attempts: 5,
    progress: {},
    result_manifest: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
    ...overrides,
  };
}

function bulkClient({ job = jobRow(), failedItemCount = 3 } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("UPDATE tenant.background_jobs") && sql.includes("status='cancelled'")) {
        if (!["pending", "processing"].includes(job.status)) return { rows: [] };
        return { rows: [{ ...job, status: "cancelled", locked_by: null }] };
      }
      if (sql.includes("SELECT status FROM tenant.background_jobs")) return { rows: [{ status: job.status }] };
      if (sql.includes("SELECT * FROM tenant.background_jobs") && sql.includes("FOR UPDATE")) {
        return { rows: [job] };
      }
      if (sql.includes("UPDATE tenant.crm_lead_bulk_job_items") && sql.includes("status='pending'")) {
        return { rows: Array.from({ length: failedItemCount }, (_, index) => ({ id: `item-${index}` })) };
      }
      if (sql.includes("UPDATE tenant.background_jobs") && sql.includes("status='pending', run_at=now()")) {
        return { rows: [{ ...job, status: "pending", attempts: 0, completed_at: null }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F029: an owner can cancel their own pending or processing bulk job", async () => {
  for (const status of ["pending", "processing"]) {
    const client = bulkClient({ job: jobRow({ status }) });
    const cancelled = await cancelLeadBulkJob(client, repContext, jobId);
    assert.equal(cancelled.status, "cancelled");
    const update = client.calls.find((call) => call.sql.includes("status='cancelled'"));
    assert.match(update.sql, /requested_by=\$4/);
    assert.deepEqual(update.values, [org, LEAD_BULK_JOB_TYPE, jobId, user]);
  }
});

test("F029: a manager (crm.records.view_all) can cancel a job requested by someone else", async () => {
  const client = bulkClient({ job: jobRow({ status: "processing", requested_by: otherUser }) });
  const cancelled = await cancelLeadBulkJob(client, managerContext, jobId);
  assert.equal(cancelled.status, "cancelled");
  const update = client.calls.find((call) => call.sql.includes("status='cancelled'"));
  assert.doesNotMatch(update.sql, /requested_by=/);
});

test("F029: a rep cannot cancel another rep's bulk job (scoped, not just an error message)", async () => {
  const client = {
    calls: [],
    async query(sql, values) {
      this.calls.push({ sql, values });
      // Scoped by requested_by=$4=user, so another rep's job never matches either query.
      return { rows: [] };
    },
  };
  await assert.rejects(
    () => cancelLeadBulkJob(client, repContext, jobId),
    (error) => error.status === 404 && error.code === "CRM_LEAD_BULK_JOB_NOT_FOUND",
  );
});

test("F029: cancelling an already-terminal job fails with a clear 409, not a silent no-op", async () => {
  const client = bulkClient({ job: jobRow({ status: "completed" }) });
  await assert.rejects(
    () => cancelLeadBulkJob(client, repContext, jobId),
    (error) => error.status === 409 && error.code === "CRM_LEAD_BULK_JOB_NOT_CANCELLABLE" && /already completed/.test(error.message),
  );
});

test("F029: retrying resets only the failed items and re-queues the job", async () => {
  const client = bulkClient({ job: jobRow({ status: "completed" }), failedItemCount: 5 });
  const retried = await retryFailedLeadBulkJobItems(client, repContext, jobId);
  assert.equal(retried.status, "pending");
  const itemReset = client.calls.find((call) => call.sql.includes("status='pending'") && call.sql.includes("crm_lead_bulk_job_items"));
  assert.match(itemReset.sql, /WHERE organization_id=\$1 AND job_id=\$2 AND status='failed'/);
  const jobReset = client.calls.find((call) => call.sql.includes("status='pending', run_at=now()"));
  assert.match(jobReset.sql, /attempts=0/);
});

test("F029: retry is rejected while the job is still in flight or already cancelled", async () => {
  for (const status of ["pending", "processing", "cancelled"]) {
    const client = bulkClient({ job: jobRow({ status }) });
    await assert.rejects(
      () => retryFailedLeadBulkJobItems(client, repContext, jobId),
      (error) => error.status === 409 && error.code === "CRM_LEAD_BULK_JOB_NOT_RETRYABLE",
    );
  }
});

test("F029: retry is rejected when the finished job has no failed rows", async () => {
  const client = bulkClient({ job: jobRow({ status: "completed" }), failedItemCount: 0 });
  await assert.rejects(
    () => retryFailedLeadBulkJobItems(client, repContext, jobId),
    (error) => error.status === 400 && error.code === "CRM_LEAD_BULK_JOB_NO_FAILED_ITEMS",
  );
});

test("F029: both actions reject a malformed job id before touching the database", async () => {
  let queries = 0;
  const client = { query: async () => { queries += 1; return { rows: [] }; } };
  await assert.rejects(
    () => cancelLeadBulkJob(client, repContext, "not-a-uuid"),
    (error) => error.code === "CRM_LEAD_BULK_JOB_INVALID",
  );
  await assert.rejects(
    () => retryFailedLeadBulkJobItems(client, repContext, "not-a-uuid"),
    (error) => error.code === "CRM_LEAD_BULK_JOB_INVALID",
  );
  assert.equal(queries, 0);
});

test("F029: the background_jobs status constraint allows 'cancelled'", async () => {
  const fs = await import("node:fs");
  const migration = fs.readFileSync(
    new URL("../../../database/tenant/migrations/079_f029_bulk_job_cancellation.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CHECK \(status IN \('pending', 'processing', 'completed', 'dead', 'cancelled'\)\)/);
});
