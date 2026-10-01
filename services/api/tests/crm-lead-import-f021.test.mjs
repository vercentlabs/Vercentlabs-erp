import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { validateLeadImportRows } from "../src/modules/crm/master-data/lead-acquisition.js";
import { LEAD_IMPORT_LIMITS, previewLeadImport } from "../src/modules/crm/data-management/import-export/lead-import.js";

// F021 durable lead import. Dry run, duplicate policies, scope-safe updates,
// synchronous vs worker execution, crash/resume without duplicates, revoked
// authority, formula-safe error download and isolation are proven against
// PostgreSQL in tests/integration/crm/lead-import-db.test.mjs. These checks
// cover the guards that must refuse input before any query runs.

const context = { organizationId: "11111111-1111-4111-8111-111111111111", userId: "44444444-4444-4444-8444-444444444444", activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: ["crm.leads.manage", "crm.import"] };
const noQueries = () => ({ query: async () => assert.fail("no query may run") });

test("F021: a file over the row limit is refused before any query", async () => {
  const rows = Array.from({ length: LEAD_IMPORT_LIMITS.maxRows + 1 }, () => ({ firstName: "A", email: "a@example.com" }));
  await assert.rejects(previewLeadImport(noQueries(), context, { rows }), (error) => error.status === 413 && error.code === "CRM_LEAD_IMPORT_TOO_MANY_ROWS");
});

test("F021: an unknown duplicate policy and an empty file are refused before any query", async () => {
  await assert.rejects(previewLeadImport(noQueries(), context, { rows: [{ firstName: "A" }], duplicateStrategy: "merge" }), (error) => error.code === "CRM_LEAD_IMPORT_STRATEGY_INVALID");
  await assert.rejects(previewLeadImport(noQueries(), context, { rows: [] }), (error) => error.code === "CRM_LEAD_IMPORT_EMPTY");
});

test("F021: row validation marks missing names, bad emails and missing contact details invalid instead of dropping them", () => {
  const rows = validateLeadImportRows(
    [{ First: "", Email: "a@example.com" }, { First: "Bea", Email: "not-an-email" }, { First: "Cy" }, { First: "Di", Email: "di@example.com" }],
    { firstName: "First", email: "Email" },
    { maxRows: 10 },
  );
  assert.deepEqual(rows.map((row) => row.valid), [false, false, false, true]);
  assert.equal(rows.length, 4);
});

test("F021: thresholds and execution rules are explicit", () => {
  assert.ok(LEAD_IMPORT_LIMITS.syncCommitRows <= 100, "only small imports run inside a request");
  assert.ok(LEAD_IMPORT_LIMITS.chunkSize <= 500, "each worker transaction is short");
  assert.equal(LEAD_IMPORT_LIMITS.maxBytes, 20 * 1024 * 1024);
  const source = fs.readFileSync(new URL("../src/modules/crm/data-management/import-export/lead-import.js", import.meta.url), "utf8");
  assert.match(source, /FOR UPDATE SKIP LOCKED/, "rows are claimed so two workers never take the same row");
  assert.match(source, /enforceScope: true/, "imports may only update leads the importer can see");
  assert.match(source, /jsonb_to_recordset/, "rows are staged in bulk, not one round trip each");
});
