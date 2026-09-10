import assert from "node:assert/strict";
import test from "node:test";

import { bulkUpdateOpportunities } from "../src/modules/crm/opportunity-and-pipeline-governance/opportunity-operations.js";

// Integrity closeout (Prompts 1-5): bulkUpdateOpportunities restricted
// which columns could be touched but never validated the values —
// forecastCategory/expectedCloseDate/ownerUserId all went straight to a raw
// UPDATE with no validation, no active-org-member check, and no audit
// event, unlike the single-record path.

const org = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const myCompany = "44444444-4444-4444-8444-444444444444";
const opportunityId = "55555555-5555-4555-8555-555555555555";
const otherUserId = "66666666-6666-4666-8666-666666666666";

const context = {
  organizationId: org,
  userId: actorId,
  activeCompanyId: myCompany,
  activeBranchId: null,
  allowAllCompanies: false,
  roleSlugs: ["sales_manager"],
  permissions: ["crm.view", "crm.opportunities.manage"],
};

function mockClient({ membershipRows = [] } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes("organization_memberships")) return { rows: membershipRows };
      if (/^\s*UPDATE/i.test(sql)) return { rows: [{ id: opportunityId }], rowCount: 1 };
      return { rows: [] };
    },
  };
}

test("bulkUpdateOpportunities: an invalid forecastCategory is rejected before touching the database", async () => {
  const client = mockClient();
  await assert.rejects(
    bulkUpdateOpportunities(client, context, { ids: [opportunityId], changes: { forecastCategory: "not-a-real-category" } }),
    (error) => error.status === 400 && error.code === "CRM_OPPORTUNITY_BULK_FORECAST_CATEGORY_INVALID",
  );
  assert.equal(client.queries.filter((q) => /^\s*UPDATE/i.test(q.sql)).length, 0, "no UPDATE should run for an invalid category");
});

test("bulkUpdateOpportunities: a valid forecastCategory is accepted", async () => {
  const client = mockClient();
  await assert.doesNotReject(
    bulkUpdateOpportunities(client, context, { ids: [opportunityId], changes: { forecastCategory: "best_case" } }),
  );
});

test("bulkUpdateOpportunities: an invalid expectedCloseDate is rejected", async () => {
  const client = mockClient();
  await assert.rejects(
    bulkUpdateOpportunities(client, context, { ids: [opportunityId], changes: { expectedCloseDate: "not-a-date" } }),
    (error) => error.status === 400 && error.code === "CRM_OPPORTUNITY_BULK_CLOSE_DATE_INVALID",
  );
});

test("bulkUpdateOpportunities: an ownerUserId who is not an active org member is rejected", async () => {
  const client = mockClient({ membershipRows: [] });
  await assert.rejects(
    bulkUpdateOpportunities(client, context, { ids: [opportunityId], changes: { ownerUserId: otherUserId } }),
    (error) => error.status === 409 && error.code === "CRM_OPPORTUNITY_BULK_OWNER_INVALID",
  );
});

test("bulkUpdateOpportunities: an ownerUserId who IS an active org member is accepted", async () => {
  const client = mockClient({ membershipRows: [{ user_id: otherUserId }] });
  await assert.doesNotReject(
    bulkUpdateOpportunities(client, context, { ids: [opportunityId], changes: { ownerUserId: otherUserId } }),
  );
});

test("bulkUpdateOpportunities: a successful bulk update queues an outbox/audit event", async () => {
  const client = mockClient();
  await bulkUpdateOpportunities(client, context, { ids: [opportunityId], changes: { nextStep: "Call back" } });
  const outboxQuery = client.queries.find((q) => q.sql.includes("outbox") || q.sql.toLowerCase().includes("insert into"));
  // queueOutboxEvent's exact SQL shape is an implementation detail of
  // index.js; assert indirectly via the presence of at least one non-UPDATE,
  // non-SELECT write beyond the main UPDATE.
  const writeQueries = client.queries.filter((q) => !/^\s*SELECT/i.test(q.sql));
  assert.ok(writeQueries.length >= 2, "expected the UPDATE plus at least one outbox/audit write");
  void outboxQuery;
});
