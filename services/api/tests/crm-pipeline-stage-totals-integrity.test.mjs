import assert from "node:assert/strict";
import test from "node:test";

import { listOpportunityPipelineStageTotals } from "../src/modules/crm/opportunity-and-pipeline-governance/stage-aging.js";

// Integrity closeout (Prompts 1-5): the pipeline board previously derived
// per-stage totals by summing whatever card rows the page happened to load
// (capped at 500 across the whole pipeline) — silently wrong for a
// pipeline with more open Opportunities than that. This is a real,
// unbounded, properly-scoped GROUP BY aggregate, independent of any card
// pagination, grouped by currency (never summed naively across
// currencies).

const org = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const myCompany = "44444444-4444-4444-8444-444444444444";
const pipelineId = "55555555-5555-4555-8555-555555555555";

const restrictedContext = {
  organizationId: org,
  userId: actorId,
  activeCompanyId: myCompany,
  activeBranchId: null,
  allowAllCompanies: false,
  roleSlugs: ["sales_representative"],
  permissions: ["crm.view", "crm.opportunities.manage"],
};

function mockClient(rows) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });
      return { rows };
    },
  };
}

test("listOpportunityPipelineStageTotals: applies the real Opportunity record scope (company/branch/owner), not just organization_id", async () => {
  const client = mockClient([]);
  await listOpportunityPipelineStageTotals(client, restrictedContext, pipelineId);
  const query = client.queries[0];
  assert.match(query.sql, /record\.company_id/, "must apply company scope");
  assert.ok(query.values.includes(myCompany), "the caller's active company must be bound");
});

test("listOpportunityPipelineStageTotals: groups by stage AND currency, never summing across currencies", async () => {
  const client = mockClient([]);
  await listOpportunityPipelineStageTotals(client, restrictedContext, pipelineId);
  assert.match(client.queries[0].sql, /GROUP BY record\.stage_id, COALESCE\(record\.currency_code/);
});

test("listOpportunityPipelineStageTotals: is not bounded by any LIMIT — a real unbounded aggregate", async () => {
  const client = mockClient([]);
  await listOpportunityPipelineStageTotals(client, restrictedContext, pipelineId);
  assert.doesNotMatch(client.queries[0].sql, /LIMIT/i);
});

test("listOpportunityPipelineStageTotals: aggregates multi-currency rows for one stage into separate per-currency totals, correctly summing amount and expected revenue", async () => {
  const stageId = "66666666-6666-4666-8666-666666666666";
  const client = mockClient([
    { stage_id: stageId, currency_code: "INR", opportunity_count: 3, amount: "150000.00", weighted_amount: "45000.00" },
    { stage_id: stageId, currency_code: "USD", opportunity_count: 1, amount: "2000.00", weighted_amount: "500.00" },
  ]);
  const totals = await listOpportunityPipelineStageTotals(client, restrictedContext, pipelineId);
  assert.equal(totals[stageId].opportunityCount, 4);
  assert.deepEqual(totals[stageId].byCurrency.INR, { opportunityCount: 3, amount: 150000, weightedAmount: 45000 });
  assert.deepEqual(totals[stageId].byCurrency.USD, { opportunityCount: 1, amount: 2000, weightedAmount: 500 });
});

test("listOpportunityPipelineStageTotals: returns an empty object without querying when no pipeline is selected", async () => {
  const client = mockClient([]);
  const totals = await listOpportunityPipelineStageTotals(client, restrictedContext, null);
  assert.deepEqual(totals, {});
  assert.equal(client.queries.length, 0);
});
