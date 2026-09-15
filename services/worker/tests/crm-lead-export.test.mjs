import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// F021 Stage A2 §9 — the async, job-based Lead export, reusing the same
// tenant.background_jobs queue crm.leads.bulk_update already uses.
test("F021 Stage A2: Lead export is registered as a managed, naturally-idempotent job", () => {
  const handlers = read("src/handlers/index.js");
  assert.match(handlers, /LEAD_EXPORT_JOB_TYPE/);
  assert.match(handlers, /handler: leadExportHandler/);
  assert.match(handlers, /transactionMode: "managed"/);
  assert.match(handlers, /idempotency: "NATURALLY_IDEMPOTENT"/);
});

test("F021 Stage A2: the export handler re-resolves execution authorization, never trusting the enqueue-time snapshot, and fails closed", () => {
  const worker = read("src/handlers/crm-lead-export.js");
  assert.match(worker, /resolveLeadBulkExecutionContext/);
  assert.match(worker, /if \(!context\) throw new Error/);
});

test("F021 Stage A2: CSV generation and completion happen inside the handler's own transaction, and the handler returns nothing so the generic post-handler completeJob call cannot overwrite the domain manifest", () => {
  const worker = read("src/handlers/crm-lead-export.js");
  assert.match(worker, /runtime\.withTenantClient/);
  assert.match(worker, /buildCrmLeadExportCsv/);
  assert.match(worker, /completeCrmLeadExportJob/);
  // The handler's async body must not end in a `return result` — that would
  // be re-written by the generic completeJob(job.id, workerId, {resultManifest: result})
  // call in managed mode, clobbering the deliberately different
  // progress/result_manifest split completeCrmLeadExportJob already wrote.
  assert.doesNotMatch(worker, /return result;/);
});
