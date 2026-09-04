import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("F001 Pass 2C worker: Lead bulk jobs are registered as managed resumable jobs", () => {
  const handlers = read("src/handlers/index.js");
  const registry = read("src/registry.js");
  assert.match(handlers, /LEAD_BULK_JOB_TYPE/);
  assert.match(handlers, /transactionMode: "managed"/);
  assert.match(handlers, /idempotency: "IDEMPOTENCY_KEY_REQUIRED"/);
  assert.match(registry, /\["tenant_transaction", "managed"\]/);
});

test("F001 Pass 2C worker: every batch rehydrates requester authorization and extends its queue lease", () => {
  const worker = read("src/handlers/crm-lead-bulk-update.js");
  assert.match(worker, /BATCH_SIZE = 100/);
  assert.match(worker, /commandFingerprint/);
  assert.match(worker, /extendJobLease/);
  assert.match(worker, /resolveLeadBulkExecutionContext/);
  assert.match(worker, /CRM_LEAD_BULK_AUTH_REVOKED/);
  assert.match(worker, /FOR UPDATE SKIP LOCKED/);
});

test("F001 Pass 2C worker: each Lead is updated through the canonical command under a savepoint", () => {
  const worker = read("src/handlers/crm-lead-bulk-update.js");
  assert.match(worker, /SAVEPOINT crm_lead_bulk_worker_item/);
  assert.match(worker, /updateCrmRecord\(client, userContext, "leads"/);
  assert.match(worker, /expectedUpdatedAt: new Date\(item\.expected_updated_at\)\.toISOString\(\)/);
  assert.match(worker, /requireVersion: true/);
  assert.match(worker, /ROLLBACK TO SAVEPOINT crm_lead_bulk_worker_item/);
  assert.match(worker, /refreshManifest/);
});

test("F001 Pass 2C worker: batch commits are managed outside the generic single-job transaction", () => {
  const handler = read("src/handlers/crm-lead-bulk-update.js");
  const generic = read("src/worker.js");
  assert.match(handler, /runtime\.withTenantClient/);
  assert.match(generic, /definition\.transactionMode === "managed"/);
  assert.match(generic, /resultManifest: result/);
});
