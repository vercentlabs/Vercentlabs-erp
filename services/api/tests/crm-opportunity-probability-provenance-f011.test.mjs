import assert from "node:assert/strict";
import test from "node:test";

import {
  getOpportunityPredictiveProbability,
  listOpportunityProbabilityHistory,
} from "../src/modules/crm/opportunity-and-pipeline-governance/opportunity-transitions.js";

// F011 gap-closure (benchmark: "Probability and expected revenue in top
// ERPs" report) — crm_opportunity_probability_history has been an
// immutable, provenance-tagged ledger since migration 066/099 (source:
// manual_override/stage_default/terminal_won/terminal_lost/reopen/restored)
// but a repository-wide grep found zero readers anywhere outside its own
// write sites and its own write-path test file. These two functions are the
// read side: one surfaces the ledger itself, the other extracts a single
// Opportunity's own predicted probability out of the org-wide predictive-
// forecast snapshot it was always computed into but never read back out of.

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const user = "44444444-4444-4444-8444-444444444444";
const opportunity = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const context = {
  organizationId: org,
  userId: user,
  activeCompanyId: company,
  activeBranchId: null,
  allowAllCompanies: false,
  roleSlugs: ["sales_representative"],
  permissions: ["crm.view", "crm.opportunities.manage"],
};

function scopeClient({ inScope = true, historyRows = [], snapshotRows = [] } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.startsWith("SELECT record.id FROM tenant.crm_opportunities record"))
        return { rows: inScope ? [{ id: opportunity }] : [] };
      if (sql.includes("FROM tenant.crm_opportunity_probability_history history"))
        return { rows: historyRows };
      if (sql.includes("FROM tenant.crm_predictive_forecast_snapshots snapshot"))
        return { rows: snapshotRows };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("listOpportunityProbabilityHistory: 404s when the opportunity is out of the caller's scope", async () => {
  const client = scopeClient({ inScope: false });
  await assert.rejects(
    () => listOpportunityProbabilityHistory(client, context, opportunity),
    (error) => {
      assert.equal(error.status, 404);
      assert.equal(error.code, "CRM_OPPORTUNITY_NOT_FOUND");
      return true;
    },
  );
});

test("listOpportunityProbabilityHistory: returns camelized rows joined with the changer's name, most recent first", async () => {
  const client = scopeClient({
    historyRows: [
      {
        id: "hist-2",
        organization_id: org,
        opportunity_id: opportunity,
        from_probability: "20.00",
        to_probability: "35.00",
        expected_revenue: "17500.00",
        note: "Champion confirmed budget",
        changed_by: user,
        changed_by_name: "Atharva Chavan",
        changed_at: "2026-09-20T00:00:00.000Z",
        source: "manual_override",
      },
    ],
  });
  const rows = await listOpportunityProbabilityHistory(client, context, opportunity);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fromProbability, "20.00");
  assert.equal(rows[0].toProbability, "35.00");
  assert.equal(rows[0].changedByName, "Atharva Chavan");
  assert.equal(rows[0].source, "manual_override");
  const historyQuery = client.queries.find((q) => q.sql.includes("FROM tenant.crm_opportunity_probability_history history"));
  assert.match(historyQuery.sql, /ORDER BY history\.changed_at DESC/);
  assert.match(historyQuery.sql, /LEFT JOIN public\.users user_account/);
});

test("listOpportunityProbabilityHistory: an out-of-range limit is clamped, never passed through raw", async () => {
  const client = scopeClient();
  await listOpportunityProbabilityHistory(client, context, opportunity, 999999);
  const historyQuery = client.queries.find((q) => q.sql.includes("FROM tenant.crm_opportunity_probability_history history"));
  assert.equal(historyQuery.values[2], 200);
});

test("getOpportunityPredictiveProbability: 404s when the opportunity is out of the caller's scope", async () => {
  const client = scopeClient({ inScope: false });
  await assert.rejects(
    () => getOpportunityPredictiveProbability(client, context, opportunity),
    (error) => {
      assert.equal(error.status, 404);
      return true;
    },
  );
});

test("getOpportunityPredictiveProbability: returns null (not an error) when no snapshot has ever included this Opportunity", async () => {
  const client = scopeClient({ snapshotRows: [] });
  const result = await getOpportunityPredictiveProbability(client, context, opportunity);
  assert.equal(result, null);
});

test("getOpportunityPredictiveProbability: extracts this Opportunity's own row from the latest snapshot's explanation->rows", async () => {
  const client = scopeClient({
    snapshotRows: [
      {
        captured_at: "2026-09-22T00:00:00.000Z",
        model_version: "crm-opportunity-forecast-v1",
        row: {
          opportunityId: opportunity,
          amount: 100000,
          predictedAmount: 42000,
          predictedProbability: 42,
          factors: { probability: 0.35, historicalWinRate: 0.4, health: 0.6 },
        },
      },
    ],
  });
  const result = await getOpportunityPredictiveProbability(client, context, opportunity);
  assert.equal(result.predictedProbability, 42);
  assert.equal(result.predictedAmount, 42000);
  assert.equal(result.modelVersion, "crm-opportunity-forecast-v1");
  assert.deepEqual(result.factors, { probability: 0.35, historicalWinRate: 0.4, health: 0.6 });
  const snapshotQuery = client.queries.find((q) => q.sql.includes("FROM tenant.crm_predictive_forecast_snapshots snapshot"));
  assert.equal(snapshotQuery.values[1], opportunity);
});
