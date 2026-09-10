import assert from "node:assert/strict";
import test from "node:test";

import { getOpportunityRevenueDashboard, getOpportunityRevenueWorkspace } from "../src/modules/crm/opportunity-revenue-intelligence.js";

// Integrity closeout (Prompts 1-5): getOpportunityRevenueDashboard's summary
// query correctly applied recordScope(), but its win/loss review, quota
// plan/allocation and mutual-action-plan queries were scoped only by
// organization_id — a company-restricted caller saw every company's loss
// reasons, competitor names, quota targets and action-plan status in this
// "dashboard," not just their own. Each is now anchored to its real parent
// (the linked Opportunity's own recordScope, or crm_quota_plans.company_id
// directly).

const org = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const myCompany = "44444444-4444-4444-8444-444444444444";

const restrictedContext = {
  organizationId: org,
  userId: actorId,
  activeCompanyId: myCompany,
  activeBranchId: null,
  allowAllCompanies: false,
  roleSlugs: ["sales_representative"],
  permissions: ["crm.view", "crm.opportunities.manage"],
};

function mockClient() {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });
      return { rows: [] };
    },
  };
}

test("getOpportunityRevenueDashboard: win/loss reviews are scoped through their linked Opportunity's own company/branch/owner scope", async () => {
  const client = mockClient();
  await getOpportunityRevenueDashboard(client, restrictedContext);
  const winLossQuery = client.queries.find((q) => q.sql.includes("FROM tenant.crm_win_loss_reviews"));
  assert.ok(winLossQuery, "expected a win/loss reviews query");
  assert.match(winLossQuery.sql, /JOIN tenant\.crm_opportunities opportunity/, "must join the parent Opportunity");
  assert.match(winLossQuery.sql, /opportunity\.company_id/, "must apply the Opportunity's own company scope");
  assert.ok(winLossQuery.values.includes(myCompany), "the caller's active company must be bound");
});

test("getOpportunityRevenueDashboard: mutual action plans are scoped through their linked Opportunity's own scope", async () => {
  const client = mockClient();
  await getOpportunityRevenueDashboard(client, restrictedContext);
  const actionPlanQuery = client.queries.find((q) => q.sql.includes("FROM tenant.crm_mutual_action_plans"));
  assert.ok(actionPlanQuery, "expected a mutual action plans query");
  assert.match(actionPlanQuery.sql, /JOIN tenant\.crm_opportunities opportunity/, "must join the parent Opportunity");
  assert.match(actionPlanQuery.sql, /opportunity\.company_id/, "must apply the Opportunity's own company scope");
});

test("getOpportunityRevenueDashboard: quota plans/allocations are scoped by their own company_id", async () => {
  const client = mockClient();
  await getOpportunityRevenueDashboard(client, restrictedContext);
  const quotaQuery = client.queries.find((q) => q.sql.includes("FROM tenant.crm_quota_plans q"));
  assert.ok(quotaQuery, "expected a quota plans query");
  assert.match(quotaQuery.sql, /q\.company_id/, "must apply company scope directly on crm_quota_plans");
  assert.ok(quotaQuery.values.includes(myCompany), "the caller's active company must be bound");
});

test("getOpportunityRevenueDashboard: a caller with no active company and no allowAllCompanies gets zero quota rows (fail closed)", async () => {
  const client = mockClient();
  const noCompanyContext = { ...restrictedContext, activeCompanyId: null };
  await getOpportunityRevenueDashboard(client, noCompanyContext);
  const quotaQuery = client.queries.find((q) => q.sql.includes("FROM tenant.crm_quota_plans q"));
  assert.match(quotaQuery.sql, /AND false/, "must fail closed when no company is selected and the actor cannot see all companies");
});

test("getOpportunityRevenueWorkspace: win/loss review query is scoped to the single requested Opportunity (not organization-wide)", async () => {
  const client = mockClient();
  const opportunityId = "33333333-3333-4333-8333-333333333333";
  // requireOpportunity (the first call inside getOpportunityRevenueWorkspace)
  // needs a row to avoid a 404 before the Promise.all queries run.
  const clientWithOpportunity = {
    queries: client.queries,
    async query(sql, values = []) {
      client.queries.push({ sql, values });
      if (sql.includes("FROM tenant.crm_opportunities record")) {
        return { rows: [{ id: opportunityId, organization_id: org, company_id: myCompany, status: "open" }] };
      }
      return { rows: [] };
    },
  };
  await getOpportunityRevenueWorkspace(clientWithOpportunity, restrictedContext, opportunityId);
  const winLossQuery = client.queries.find((q) => q.sql.includes("FROM tenant.crm_win_loss_reviews"));
  assert.ok(winLossQuery, "expected a win/loss review query");
  assert.match(winLossQuery.sql, /opportunity_id=\$2/, "must filter to the single requested Opportunity, not the whole organization");
});
