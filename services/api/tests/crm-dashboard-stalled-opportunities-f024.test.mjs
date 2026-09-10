import assert from "node:assert/strict";
import test from "node:test";

import { getCrmDashboard } from "../src/modules/crm/index.js";

// F024 (Pipeline dashboard) — LAST PROMPT 1/3 closeout: the dossier's
// required "stalled/risk signals" item had a real per-stage threshold
// (crm_opportunity_stage_sla_policies, falling back to
// crm_pipeline_stages.stale_after_days — already used by the pipeline
// board's stage-aging.js) but no Opportunity-side signal on the dashboard
// itself. This proves the new stalled_opportunities metric (a) is present
// in the query, (b) reuses the SLA-policy-over-stage-default precedence,
// and (c) is scoped by the same company/branch/owner predicates as every
// other dashboard metric.

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

test("F024: getCrmDashboard exposes stalled_opportunities using the SLA-policy-over-stage-default threshold", async () => {
  let capturedSql = null;
  const client = {
    async query(sql, values) {
      if (/^SELECT\s+\(SELECT organization\.base_currency/.test(sql.trim())) {
        capturedSql = sql;
        return { rows: [{ stalled_opportunities: 7, open_opportunities: 40 }] };
      }
      return { rows: [] };
    },
  };
  const dashboard = await getCrmDashboard(client, context);
  assert.equal(dashboard.metrics.stalledOpportunities, 7);
  assert.ok(capturedSql, "expected the metrics query to run");
  assert.match(capturedSql, /AS stalled_opportunities/);
  assert.match(capturedSql, /COALESCE\(policy\.maximum_days, stage\.stale_after_days\)/);
  assert.match(capturedSql, /crm_opportunity_stage_sla_policies policy/);
  assert.match(capturedSql, /opportunity\.stage_entered_at <= now\(\) - \(COALESCE\(policy\.maximum_days, stage\.stale_after_days\) \|\| ' days'\)::interval/);
  // Same scope predicates as every other Opportunity-backed metric on this
  // dashboard (open_opportunities, pipeline_value, weighted_pipeline).
  const stalledClause = capturedSql.slice(capturedSql.indexOf("AS stalled_opportunities") - 900, capturedSql.indexOf("AS stalled_opportunities"));
  assert.match(stalledClause, /company_id/);
  assert.match(stalledClause, /owner_user_id/);
});

test("F024: an opportunity with no configured threshold (no SLA policy, no stale_after_days) is never counted as stalled", async () => {
  // COALESCE(...) IS NOT NULL guards this — an unconfigured stage must not
  // silently default to some arbitrary threshold and start flagging deals
  // nobody asked to be flagged.
  const client = {
    async query(sql) {
      if (/^SELECT\s+\(SELECT organization\.base_currency/.test(sql.trim())) {
        assert.match(sql, /COALESCE\(policy\.maximum_days, stage\.stale_after_days\) IS NOT NULL/);
        return { rows: [{ stalled_opportunities: 0 }] };
      }
      return { rows: [] };
    },
  };
  const dashboard = await getCrmDashboard(client, context);
  assert.equal(dashboard.metrics.stalledOpportunities, 0);
});
