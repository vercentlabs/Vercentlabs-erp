import assert from "node:assert/strict";
import test from "node:test";

import { bulkUpdateOpportunities } from "../src/modules/crm/opportunity-and-pipeline-governance/opportunity-operations.js";

// F029 — the synchronous Opportunity bulk edit runs each row through the
// single-record command in its own savepoint, reports every row, and in
// preview mode rolls every row back so nothing is written.

const org = "11111111-1111-4111-8111-111111111111";
const ids = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"];
const context = { organizationId: org, userId: "22222222-2222-4222-8222-222222222222", activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, permissions: [], roleSlugs: [] };

function client() {
  const statements = [];
  return {
    statements,
    async query(sql) {
      statements.push(sql.trim());
      return { rows: [], rowCount: 0 };
    },
  };
}

test("F029: every row gets its own savepoint and its own outcome", async () => {
  const c = client();
  const result = await bulkUpdateOpportunities(c, context, { ids, changes: { nextStep: "Call back" } });
  assert.equal(result.items.length, 2);
  assert.equal(c.statements.filter((sql) => sql === "SAVEPOINT crm_opportunity_bulk_item").length, 2);
  assert.ok(result.items.every((item) => ["applied", "conflict", "skipped", "failed"].includes(item.status)));
});

test("F029: preview never keeps a write — every row is rolled back", async () => {
  const c = client();
  const result = await bulkUpdateOpportunities(c, context, { ids, changes: { nextStep: "Call back" }, preview: true });
  assert.equal(result.preview, true);
  assert.equal(result.applied, 0);
  const rollbacks = c.statements.filter((sql) => sql === "ROLLBACK TO SAVEPOINT crm_opportunity_bulk_item").length;
  assert.equal(rollbacks, 2, "each previewed row is rolled back");
  assert.ok(!c.statements.some((sql) => sql.startsWith("INSERT INTO tenant.platform_events")), "no bulk event is emitted for a preview");
});

test("F029: a bulk edit cannot set a stage-governed field", async () => {
  await assert.rejects(
    bulkUpdateOpportunities(client(), context, { ids, changes: { forecastCategory: "committed" } }),
    (error) => error.code === "CRM_OPPORTUNITY_BULK_FIELD_UNSUPPORTED",
  );
});
