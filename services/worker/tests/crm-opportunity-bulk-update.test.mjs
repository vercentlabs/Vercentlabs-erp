import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// F029 (Bulk actions) — LAST PROMPT 1/3 closeout. Mirrors
// crm-lead-bulk-update.test.mjs's structure exactly — Opportunities never
// had an async bulk path at all before this pass (unlike Leads, whose
// version of this same test predates this prompt).

test("F029 worker: Opportunity bulk jobs are registered as managed resumable jobs", () => {
  const handlers = read("src/handlers/index.js");
  const registry = read("src/registry.js");
  assert.match(handlers, /OPPORTUNITY_BULK_JOB_TYPE/);
  assert.match(handlers, /opportunityBulkUpdateHandler/);
  assert.match(handlers, /registerJobHandler\(OPPORTUNITY_BULK_JOB_TYPE, \{[\s\S]*?transactionMode: "managed",[\s\S]*?\}\);/);
  assert.match(registry, /\["tenant_transaction", "managed"\]/);
});

test("F029 worker: every batch rehydrates requester authorization and extends its queue lease", () => {
  const worker = read("src/handlers/crm-opportunity-bulk-update.js");
  assert.match(worker, /BATCH_SIZE = 100/);
  assert.match(worker, /commandFingerprint/);
  assert.match(worker, /extendJobLease/);
  assert.match(worker, /resolveOpportunityBulkExecutionContext/);
  assert.match(worker, /CRM_OPPORTUNITY_BULK_AUTH_REVOKED/);
  assert.match(worker, /FOR UPDATE SKIP LOCKED/);
});

test("F029 worker: each Opportunity is updated through the canonical command under a savepoint", () => {
  const worker = read("src/handlers/crm-opportunity-bulk-update.js");
  assert.match(worker, /SAVEPOINT crm_opportunity_bulk_worker_item/);
  assert.match(worker, /updateCrmRecord\(client, userContext, "opportunities"/);
  assert.match(worker, /expectedUpdatedAt: new Date\(item\.expected_updated_at\)\.toISOString\(\)/);
  assert.match(worker, /requireVersion: true/);
  assert.match(worker, /ROLLBACK TO SAVEPOINT crm_opportunity_bulk_worker_item/);
  assert.match(worker, /refreshManifest/);
});

test("F029 worker: batch commits are managed outside the generic single-job transaction", () => {
  const handler = read("src/handlers/crm-opportunity-bulk-update.js");
  const generic = read("src/worker.js");
  assert.match(handler, /runtime\.withTenantClient/);
  assert.match(generic, /definition\.transactionMode === "managed"/);
  assert.match(generic, /resultManifest: result/);
});

test("F029 worker: the payload schema validates the same field/value shape the synchronous path enforces", () => {
  const worker = read("src/handlers/crm-opportunity-bulk-update.js");
  // expected_close_date is a `date` column (confirmed against
  // database/tenant/migrations/002_crm_module.sql), not timestamptz — the
  // schema must not reuse Leads' stricter full-ISO-datetime-with-offset
  // shape for a plain date field.
  assert.doesNotMatch(worker, /expectedCloseDate: z\.string\(\)\.datetime/);
  assert.match(worker, /forecastCategory: z\s*\n?\s*\.enum\(\["omitted", "pipeline", "best_case", "committed", "closed"\]\)/);
});
