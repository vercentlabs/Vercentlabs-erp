import assert from "node:assert/strict";
import test from "node:test";

import { getCrmDashboard, resolveDashboardOptions } from "../src/modules/crm/pipeline-analytics-and-forecasting/analytics-service.js";
import { buildFilters } from "../src/modules/crm/crm-data-operations-and-customization/resource-query-service.js";
import { resources } from "../src/modules/crm/crm-data-operations-and-customization/resource-registry.js";
import { listCrmTasks } from "../src/modules/crm/seller-activity-and-follow-up-workspace/task-operations.js";

// F024 — the dashboard gained a scope (mine / my team / all permitted) and a
// reporting period with a previous-period comparison; every figure drills
// into a list using the same scope and date predicates.

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const viewAll = { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, permissions: ["crm.records.view_all"], roleSlugs: [] };
const rep = { ...viewAll, permissions: [] };

function capture() {
  const calls = [];
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{}] }; } };
}

test("F024: the period defaults to the current month and the previous period is the same length immediately before it", () => {
  const explicit = resolveDashboardOptions({ from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(explicit, { scope: "all", from: "2026-09-01", to: "2026-09-30", previousFrom: "2026-08-02", previousTo: "2026-08-31" });
  const defaults = resolveDashboardOptions();
  assert.match(defaults.from, /^\d{4}-\d{2}-01$/);
  assert.equal(resolveDashboardOptions({ scope: "everyone" }).scope, "all", "an unknown scope falls back to the permitted default");
  assert.equal(resolveDashboardOptions({ from: "2026-09-10", to: "2026-09-01" }).to, "2026-09-10", "an inverted range collapses rather than failing");
  assert.equal(resolveDashboardOptions({ from: "'; DROP", to: "x" }).from, defaults.from, "non-date input is ignored, never interpolated");
});

test("F024: 'mine' restricts every owner-scoped figure to the caller, on top of — never instead of — the permitted scope", async () => {
  const client = capture();
  await getCrmDashboard(client, viewAll, { scope: "mine", from: "2026-09-01", to: "2026-09-30" });
  const metrics = client.calls[0];
  // Permitted scope (own + unassigned + managed team, crm-access-scope.js), then narrowed to "mine".
  // View-all caller: the permitted scope folds to the umbrella guard, then
  // "mine" narrows it to the caller (the rep-scoped shape is tested below).
  assert.match(metrics.sql, /\(\$5::boolean OR \(\$6::uuid IS NULL OR true\)\) AND lead\.owner_user_id = \$6/);
  assert.deepEqual(metrics.params.slice(6), ["2026-09-01", "2026-09-30", "2026-08-02", "2026-08-31"]);
  assert.match(metrics.sql, /AND false AND .*AS unassigned_leads/s, "org-wide signals are suppressed outside the 'all' scope");
});

test("F024: 'team' adds members of sales teams the caller manages, still within the permitted scope", async () => {
  const client = capture();
  await getCrmDashboard(client, rep, { scope: "team" });
  const sql = client.calls[0].sql;
  assert.match(sql, /\(\$5::boolean OR \(\(opportunity\.owner_user_id IS NULL OR opportunity\.owner_user_id = \$6 OR EXISTS \(SELECT 1 FROM tenant\.crm_sales_team_members[\s\S]*?\)\)\)\) AND \(opportunity\.owner_user_id = \$6 OR opportunity\.owner_user_id IN \(SELECT member\.user_id FROM tenant\.crm_sales_team_members member/);
  assert.match(sql, /team\.manager_user_id = \$6/);
  assert.equal(client.calls[0].params[4], false, "a rep without view-all keeps the narrow permitted scope");
});

test("F024: period figures (new leads, conversions, won, lost) and their previous-period twins use the chosen dates", async () => {
  const client = capture();
  await getCrmDashboard(client, viewAll, { from: "2026-07-01", to: "2026-09-30" });
  const sql = client.calls[0].sql;
  for (const alias of ["leads_in_period", "leads_previous_period", "conversions_in_period", "won_in_period", "won_amount_in_period", "won_amount_previous_period", "lost_in_period", "lost_previous_period", "overdue_tasks"])
    assert.match(sql, new RegExp(`AS ${alias}`));
  assert.match(sql, /opportunity\.actual_close_date >= \$7::date AND opportunity\.actual_close_date < \$8::date \+ 1/);
  assert.match(sql, /lead\.converted_at >= \$9::date AND lead\.converted_at < \$10::date \+ 1/);
  assert.equal(client.calls[1].params.length, 6, "the stage/source/activity queries bind only the parameters they reference");
});

test("F024: record-list drill-down honours ownerId=team, closed (won+lost), and the period date ranges", () => {
  const params = [];
  const opp = buildFilters(resources.opportunities, { ownerId: "team", status: "closed", closedFrom: "2026-09-01", closedTo: "2026-09-30" }, params, "record", rep);
  assert.match(opp, /record\.status IN \('won','lost'\)/);
  assert.match(opp, /record\.owner_user_id IN \(SELECT member\.user_id/);
  assert.match(opp, /record\.actual_close_date >= \$\d+::date/);
  assert.match(opp, /record\.actual_close_date <= \$\d+::date/);
  const leadParams = [];
  const lead = buildFilters(resources.leads, { includeConverted: "true", createdFrom: "2026-09-01", createdTo: "2026-09-30" }, leadParams, "record", rep);
  assert.match(lead, /record\.record_status IN \('active','converted'\)/);
  assert.match(lead, /record\.created_at >= \$\d+::date/);
  assert.ok(leadParams.includes("2026-09-01"));
  const bad = buildFilters(resources.leads, { createdFrom: "yesterday" }, [], "record", rep);
  assert.doesNotMatch(bad, /created_at/, "a non-date value is ignored rather than bound");
});

test("F024: the task list's 'my team' filter mirrors the dashboard's team rule", async () => {
  const calls = [];
  const client = { query: async (sql) => { calls.push(sql); return { rows: [{ total: 0 }] }; } };
  await listCrmTasks(client, viewAll, { myTeam: true, due: "overdue" });
  assert.match(calls[0], /activity\.assigned_to IN \(SELECT member\.user_id FROM tenant\.crm_sales_team_members member/);
});
