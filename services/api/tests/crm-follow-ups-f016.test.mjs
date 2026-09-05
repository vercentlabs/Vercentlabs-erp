import assert from "node:assert/strict";
import test from "node:test";

import { listMyNurtureQueueItems } from "../src/modules/crm/lead-intelligence.js";

const orgId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function nurtureClient() {
  const calls = [];
  return {
    calls,
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_lead_nurture_queue queue"))
        return {
          rows: [
            { id: "q1", priority_score: 80, recommended_action: "call_now", due_at: "2026-09-05T10:00:00Z", status: "active", lead_id: "l1", full_name: "Rahul Sharma", company_name: "Acme" },
          ],
        };
      return { rows: [] };
    },
  };
}

test("F016: a rep with sensitive-content access gets their own nurture queue", async () => {
  const context = {
    organizationId: orgId,
    userId,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    roleSlugs: ["sales_representative"],
    permissions: ["crm.view", "crm.leads.view_sensitive"],
  };
  const client = nurtureClient();
  const items = await listMyNurtureQueueItems(client, context);
  assert.equal(items.length, 1);
  assert.equal(items[0].full_name, "Rahul Sharma");
});

test("F016: a manager's crm.records.view_all is stripped before scoping — 'my' queue never broadens to the team's", async () => {
  const context = {
    organizationId: orgId,
    userId,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    roleSlugs: ["sales_manager", "organization_owner"],
    permissions: ["crm.view", "crm.leads.view_sensitive", "crm.records.view_all"],
  };
  const client = nurtureClient();
  await listMyNurtureQueueItems(client, context);
  const queueCall = client.calls.find((call) => call.sql.includes("FROM tenant.crm_lead_nurture_queue queue"));
  // owner_user_id scoping must be present in the query — proving view_all/
  // organization_owner did not bypass the "mine only" filter.
  assert.match(queueCall.sql, /owner_user_id/);
  assert.equal(queueCall.values.includes(userId), true);
});

test("F016: without crm.leads.view_sensitive, the queue is forbidden rather than silently empty", async () => {
  const context = {
    organizationId: orgId,
    userId,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    roleSlugs: [],
    permissions: ["crm.view"],
  };
  await assert.rejects(
    listMyNurtureQueueItems(nurtureClient(), context),
    (error) => error.status === 403 && error.code === "CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN",
  );
});
