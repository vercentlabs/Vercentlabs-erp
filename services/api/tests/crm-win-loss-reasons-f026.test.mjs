import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getCrmReport } from "../src/modules/crm/pipeline-analytics-and-forecasting/analytics-service.js";
import { buildFilters } from "../src/modules/crm/crm-data-operations-and-customization/resource-query-service.js";
import { resources } from "../src/modules/crm/crm-data-operations-and-customization/resource-registry.js";

// F026 — won/lost reasons: a report of closed deals by outcome and reason for
// a period, whose every row drills into the Opportunities list with the same
// predicates; and a database guard that keeps close/reopen history immutable.

const context = { organizationId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, permissions: [], roleSlugs: [] };
const reasonId = "33333333-3333-4333-8333-333333333333";

async function reportSql(filters) {
  let captured;
  await getCrmReport({ query: async (sql, params) => { captured = { sql, params }; return { rows: [] }; } }, context, "win-loss", filters);
  return captured;
}

test("F026: the win-loss report groups closed deals by outcome and reason, dated by actual close date", async () => {
  const { sql, params } = await reportSql({ from: "2026-09-01", to: "2026-09-30" });
  assert.match(sql, /opportunity\.status IN \('won','lost'\)/);
  assert.match(sql, /opportunity\.actual_close_date >= \$5::date/);
  assert.match(sql, /GROUP BY opportunity\.status, opportunity\.outcome_reason_id, reason\.name/);
  assert.match(sql, /'No reason recorded'/);
  assert.equal(params[4], "2026-09-01");
});

test("F026: the report never aggregates deals the caller could not open (owner visibility applies)", async () => {
  const { sql, params } = await reportSql({});
  assert.match(sql, /\(\$7::boolean OR opportunity\.owner_user_id IS NULL OR opportunity\.owner_user_id = \$8\)/);
  assert.equal(params[6], false, "a caller without view-all keeps the narrow scope");
});

test("F026: a reason row drills into the list with the same outcome, reason and close-date predicates", () => {
  const params = [];
  const sql = buildFilters(resources.opportunities, { status: "lost", outcomeReasonId: reasonId, closedFrom: "2026-09-01", closedTo: "2026-09-30" }, params, "record", context);
  assert.match(sql, /record\.outcome_reason_id = \$\d+::uuid/);
  assert.match(sql, /record\.actual_close_date >= \$\d+::date/);
  assert.ok(params.includes(reasonId));
  assert.match(buildFilters(resources.opportunities, { outcomeReasonId: "none" }, [], "record", context), /record\.outcome_reason_id IS NULL/);
  assert.doesNotMatch(buildFilters(resources.opportunities, { outcomeReasonId: "1; DROP" }, [], "record", context), /outcome_reason_id/, "a non-uuid is ignored, never bound");
});

test("F026: the list route forwards outcomeReasonId", () => {
  const route = readFileSync(new URL("../../../apps/web/src/app/api/crm/[resource]/route.ts", import.meta.url), "utf8");
  assert.match(route, /"outcomeReasonId"/);
});

test("F026: close/reopen history is immutable in the database, except for cascaded parent removal", () => {
  const migration = readFileSync(new URL("../../../database/tenant/migrations/173_f026_opportunity_outcome_history_immutable.sql", import.meta.url), "utf8");
  assert.match(migration, /BEFORE UPDATE OR DELETE ON tenant\.crm_opportunity_stage_history/);
  assert.match(migration, /TG_OP = 'DELETE' AND pg_trigger_depth\(\) > 1/);
});
