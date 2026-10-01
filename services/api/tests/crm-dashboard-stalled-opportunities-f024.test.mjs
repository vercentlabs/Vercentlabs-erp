import assert from "node:assert/strict";
import test from "node:test";

import { getCrmDashboard } from "../src/modules/crm/index.js";
import { normalizeAnalyticsFilters, opportunityFactsCte } from "../src/modules/crm/analytics/opportunity-facts.js";

// F024 stalled-opportunity signal. The threshold rule (an SLA policy's
// maximum_days over the stage's stale_after_days, and no threshold = never
// stalled) now lives once, in the canonical opportunity fact set that the
// dashboard, drill-downs, forecast and reports all read. The real-database
// count is proven by tests/integration/crm/pipeline-metrics-db.test.mjs.

const org = "11111111-1111-4111-8111-111111111111";
const owner = "22222222-2222-4222-8222-222222222222";

const context = {
  organizationId: org,
  userId: owner,
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: [],
  permissions: ["crm.view", "crm.records.view_all"],
};

test("F024: the canonical fact set computes stalled with the SLA-policy-over-stage-default threshold", () => {
  const sql = opportunityFactsCte(context, normalizeAnalyticsFilters({}), []);
  assert.match(sql, /crm_opportunity_stage_sla_policies policy/);
  assert.match(sql, /o\.stage_entered_at <= now\(\) - \(COALESCE\(policy\.maximum_days, stage\.stale_after_days\) \|\| ' days'\)::interval\) AS stalled/);
});

test("F024: an opportunity with no configured threshold is never counted as stalled", () => {
  const sql = opportunityFactsCte(context, normalizeAnalyticsFilters({}), []);
  assert.match(sql, /COALESCE\(policy\.maximum_days, stage\.stale_after_days\) IS NOT NULL/);
});

test("F024: the dashboard's stalledOpportunities is the canonical metric, not a second formula", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("opportunity_facts") && sql.includes("AS stalled_opportunities")) return { rows: [{ stalled_opportunities: 7, open_opportunities: 40 }] };
      return { rows: [{}] };
    },
  };
  const dashboard = await getCrmDashboard(client, context);
  assert.equal(dashboard.metrics.stalledOpportunities, 7);
  assert.equal(dashboard.metrics.openOpportunities, 40);
});
