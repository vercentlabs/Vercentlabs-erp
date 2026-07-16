import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateLeadScore,
  getCrmDashboard,
  isCrmResource,
  listCrmRecords,
} from "../src/crm.js";
test("CRM rejects unknown resources", () =>
  assert.equal(isCrmResource("anything"), false));
test("CRM exposes all governed resources", () => {
  for (const key of [
    "leads",
    "opportunities",
    "activities",
    "campaigns",
    "communications",
    "pipelines",
    "stages",
    "sources",
    "scoring-rules",
    "assignment-rules",
    "sequences",
    "sequence-steps",
    "sequence-enrollments",
    "automation-rules",
    "capture-forms",
    "integrations",
    "webhook-subscriptions",
    "saved-views",
  ])
    assert.equal(isCrmResource(key), true, key);
});
test("lead scoring applies deterministic active rules", async () => {
  const client = {
    async query() {
      return {
        rows: [
          {
            field_name: "industry",
            operator: "equals",
            comparison_value: "manufacturing",
            points: 20,
          },
          {
            field_name: "email",
            operator: "not_empty",
            comparison_value: null,
            points: 5,
          },
        ],
      };
    },
  };
  assert.equal(
    await calculateLeadScore(client, "org", {
      industry: "manufacturing",
      email: "a@example.com",
    }),
    25,
  );
});
test("CRM list queries remain organization scoped", async () => {
  let captured = "";
  const client = {
    async query(text) {
      captured = text;
      return { rows: [] };
    },
  };
  await listCrmRecords(
    client,
    {
      organizationId: "00000000-0000-4000-8000-000000000000",
      userId: "00000000-0000-4000-8000-000000000001",
      activeCompanyId: null,
      activeBranchId: null,
      allowAllCompanies: true,
    },
    "leads",
    {},
  );
  assert.match(captured, /record\.organization_id = \$1/);
});
test("CRM dashboard serializes queries on a transaction client", async () => {
  let active = false;
  let calls = 0;
  const client = {
    async query() {
      assert.equal(active, false, "client.query calls must not overlap");
      active = true;
      await new Promise((resolve) => setImmediate(resolve));
      active = false;
      calls += 1;
      return { rows: calls === 1 ? [{}] : [] };
    },
  };

  await getCrmDashboard(client, {
    organizationId: "00000000-0000-4000-8000-000000000000",
  });
  assert.equal(calls, 4);
});
