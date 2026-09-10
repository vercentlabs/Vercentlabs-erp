import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// F021 (Lead import and export) — LAST PROMPT 1/3 closeout: the import
// route had no dry-run/preview mode (CRM-VNEXT-059). This route's logic
// lives directly in the Next.js route handler (not a separately-testable
// services/api domain function — an existing architecture characteristic
// of this one route, not something this pass changed), and no behavioral
// test harness for Next.js route.ts handlers exists anywhere in this
// codebase yet (apps/web/tests has zero examples of invoking a route.ts
// POST/GET export directly against mocked dependencies), so — consistent
// with this codebase's own established fallback for genuinely hard-to-mock
// surfaces (e.g. services/worker/tests/crm-lead-bulk-update.test.mjs) —
// this is a source-assertion test, not a claim that it is equivalent to
// exercising the real code path.

test("F021: a dry run reuses the exact same parse/validate/create loop as a real import, not a separate preview validator", () => {
  const source = read("src/modules/crm/crm-data-operations-and-customization/route-handlers/lead-import.ts");
  // The dry-run branch must not skip the row loop or call a different
  // validation function — it shares the identical crmSchemas[...].parseAsync
  // + createCrmRecord call sites the non-dry-run path uses.
  const rowLoopStart = source.indexOf("for (let index = 1; index < rows.length; index += 1)");
  const dryRunThrow = source.indexOf("if (dryRun) {", rowLoopStart);
  assert.ok(rowLoopStart > 0 && dryRunThrow > rowLoopStart, "dry-run abort must come AFTER the shared row loop, not bypass it");
  assert.match(source, /class DryRunAbort extends Error/);
});

test("F021: a dry run never claims the idempotency receipt slot or persists a receipt row", () => {
  const source = read("src/modules/crm/crm-data-operations-and-customization/route-handlers/lead-import.ts");
  assert.match(source, /if \(!dryRun\) \{\s*\n\s*await client\.query\(\s*\n\s*"SELECT pg_advisory_xact_lock/);
  assert.doesNotMatch(source, /if \(dryRun\)[\s\S]{0,120}INSERT INTO tenant\.crm_import_receipts/);
});

test("F021: a dry run never increments billing usage", () => {
  const source = read("src/modules/crm/crm-data-operations-and-customization/route-handlers/lead-import.ts");
  assert.match(source, /if \(!dryRun\) await requireBillingWriteAccess/);
  assert.match(source, /if \(!dryRun && !result\.replayed\)\s*\n\s*await incrementBillingUsage/);
  assert.match(source, /if \(!dryRun && !result\.replayed && processedRows\)/);
});

test("F021: DryRunAbort's rollback guarantee comes from tenantTransaction's own throw->rollback contract, not a new mechanism", () => {
  const dbSource = read("src/core/db.ts");
  assert.match(dbSource, /catch \(error\) \{\s*\n\s*await client\.query\("ROLLBACK"\)/);
  const routeSource = read("src/modules/crm/crm-data-operations-and-customization/route-handlers/lead-import.ts");
  assert.match(routeSource, /throw new DryRunAbort\(\{/);
  assert.match(routeSource, /if \(error instanceof DryRunAbort\) \{\s*\n\s*result = error\.preview;/);
});

test("F021: the dry-run response message is explicit that no records were created", () => {
  const source = read("src/modules/crm/crm-data-operations-and-customization/route-handlers/lead-import.ts");
  assert.match(source, /Dry run:.*No records were created\./);
});
