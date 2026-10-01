import assert from "node:assert/strict";
import test from "node:test";

import { getCrmDashboard, resolveDashboardOptions } from "../src/modules/crm/analytics/analytics-service.js";
import { buildFilters } from "../src/modules/crm/data-management/resource-query-service.js";
import { resources } from "../src/modules/crm/data-management/resource-registry.js";
import { listCrmTasks } from "../src/modules/crm/activities/task-operations.js";

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
  assert.match(metrics.sql, /owner_user_id IS NULL AND false\)::int AS unassigned_leads/, "org-wide signals are suppressed outside the 'all' scope");
});

test("F024: 'team' adds members of sales teams the caller manages, still within the permitted scope", async () => {
  const client = capture();
  await getCrmDashboard(client, rep, { scope: "team" });
  const sql = client.calls[0].sql;
  assert.match(sql, /\(\$5::boolean OR \(\(lead\.owner_user_id IS NULL OR lead\.owner_user_id = \$6 OR COALESCE\(\([^)]*\) IN \(SELECT team_member\.organization_id, team_member\.user_id FROM tenant\.crm_sales_team_members[\s\S]*?\)\)\)\) AND \(lead\.owner_user_id = \$6 OR lead\.owner_user_id IN \(SELECT member\.user_id FROM tenant\.crm_sales_team_members member/);
  // Opportunity figures come from the canonical fact set with the same team rule.
  const facts = client.calls.find((call) => call.sql.includes("opportunity_facts"));
  assert.match(facts.sql, /o\.owner_user_id IN \(SELECT member\.user_id FROM tenant\.crm_sales_team_members member/);
  assert.match(sql, /team\.manager_user_id = \$6/);
  assert.equal(client.calls[0].params[4], false, "a rep without view-all keeps the narrow permitted scope");
});

test("F024: period figures (new leads, conversions, won, lost) and their previous-period twins use the chosen dates", async () => {
  const client = capture();
  await getCrmDashboard(client, viewAll, { from: "2026-07-01", to: "2026-09-30" });
  const sql = client.calls[0].sql;
  for (const alias of ["leads_in_period", "leads_previous_period", "conversions_in_period", "overdue_tasks"])
    assert.match(sql, new RegExp(`AS ${alias}`));
  // Won/lost come from the canonical metric layer: once for the period, once for its twin.
  const metricCalls = client.calls.filter((call) => call.sql.includes("opportunity_facts") && call.sql.includes("AS won_amount"));
  assert.equal(metricCalls.length, 2);
  assert.match(metricCalls[0].sql, /f\.status='won' AND f\.actual_close_date BETWEEN \$\d+::date AND \$\d+::date/);
  assert.ok(metricCalls[0].params.includes("2026-07-01") && metricCalls[0].params.includes("2026-09-30"));
  assert.ok(metricCalls[1].params.includes("2026-06-30"), "the previous period ends the day before");
  assert.match(sql, /lead\.converted_at >= \$9::date AND lead\.converted_at < \$10::date \+ 1/);
  const sourcesCall = client.calls.find((call) => call.sql.includes("crm_lead_sources source") && !call.sql.includes("opportunity_facts"));
  assert.equal(sourcesCall.params.length, 6, "the source/activity queries bind only the parameters they reference");
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
