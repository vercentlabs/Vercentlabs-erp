import assert from "node:assert/strict";
import test from "node:test";

import { getCrmReport } from "../src/modules/crm/pipeline-analytics-and-forecasting/analytics-service.js";
import { buildFilters } from "../src/modules/crm/crm-data-operations-and-customization/resource-query-service.js";
import { resources } from "../src/modules/crm/crm-data-operations-and-customization/resource-registry.js";

// F025 — two real bugs in the forecast report: its Commit column filtered on
// forecast_category='commit' (the governed value is 'committed', so Commit
// was always 0), and its date range filtered on created_at, so a period
// dropped deals closing in it but created earlier.

const context = { organizationId: "11111111-1111-4111-8111-111111111111", userId: "22222222-2222-4222-8222-222222222222", activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, permissions: ["crm.records.view_all"], roleSlugs: [] };

async function forecastSql(filters) {
  let captured;
  const client = { query: async (sql, params) => { captured = { sql, params }; return { rows: [] }; } };
  await getCrmReport(client, context, "forecast", filters);
  return captured;
}

test("F025: Commit sums the governed 'committed' category", async () => {
  const { sql } = await forecastSql({});
  assert.match(sql, /forecast_category='committed'/);
  assert.doesNotMatch(sql, /forecast_category='commit'[^t]/);
});

test("F025: a forecast period uses expected close date for open deals and the won date for won deals — never created_at", async () => {
  const { sql, params } = await forecastSql({ from: "2026-10-01", to: "2026-12-31" });
  assert.doesNotMatch(sql, /opportunity\.created_at/);
  assert.match(sql, /opportunity\.status='open' AND \(\$5::date IS NULL OR opportunity\.expected_close_date >= \$5::date\)/);
  assert.match(sql, /opportunity\.status='won' AND \(\$5::date IS NULL OR opportunity\.actual_close_date >= \$5::date\)/);
  assert.equal(params[4], "2026-10-01");
  assert.equal(params[5], "2026-12-31");
});

test("F025: forecast cells drill into lists using the same expected-close range and category", () => {
  const params = [];
  const sql = buildFilters(resources.opportunities, { status: "open", expectedCloseFrom: "2026-10-01", expectedCloseTo: "2026-12-31", forecastCategory: "committed" }, params, "record", context);
  assert.match(sql, /record\.expected_close_date >= \$\d+::date/);
  assert.match(sql, /record\.expected_close_date <= \$\d+::date/);
  assert.match(sql, /record\.forecast_category = \$\d+/);
  assert.doesNotMatch(buildFilters(resources.opportunities, { forecastCategory: "anything" }, [], "record", context), /forecast_category/, "an unknown category is ignored, not bound");
});

test("F024/F025: the list route forwards every drill-down key buildFilters understands (a dropped key silently widens the list)", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync(new URL("../../../apps/web/src/app/api/crm/[resource]/route.ts", import.meta.url), "utf8");
  for (const key of ["ownerId", "createdFrom", "createdTo", "convertedFrom", "convertedTo", "includeConverted", "closedFrom", "closedTo", "expectedCloseFrom", "expectedCloseTo", "forecastCategory"])
    assert.match(route, new RegExp(`"${key}"`), `${key} must be in LIST_FILTER_KEYS`);
});
