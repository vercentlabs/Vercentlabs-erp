import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateLeadScore,
  createCrmRecord,
  getCrmDashboard,
  getCrmOptions,
  getCrmReport,
  isCrmResource,
  listCrmRecords,
  updateCrmRecord,
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
    "sales-teams",
    "sales-team-members",
    "territories",
    "territory-assignments",
    "quota-plans",
    "forecast-periods",
    "forecast-submissions",
    "account-plans",
    "account-stakeholders",
    "playbooks",
    "playbook-questions",
    "playbook-responses",
    "consent-events",
    "privacy-requests",
    "data-quality-scores",
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
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
  });
  assert.equal(calls, 4);
});


test("company and branch scope is applied to CRM record lists", async () => {
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
      activeCompanyId: "00000000-0000-4000-8000-000000000002",
      activeBranchId: "00000000-0000-4000-8000-000000000003",
      allowAllCompanies: false,
    },
    "leads",
    {},
  );
  assert.match(captured, /record\.company_id IS NULL/);
  assert.match(captured, /record\.branch_id IS NULL/);
});

test("governed opportunity fields cannot be changed through generic PATCH", async () => {
  const client = {
    async query() {
      return {
        rows: [
          {
            id: "00000000-0000-4000-8000-000000000010",
            organization_id: "00000000-0000-4000-8000-000000000000",
            company_id: "00000000-0000-4000-8000-000000000002",
            branch_id: null,
            stage_id: "00000000-0000-4000-8000-000000000011",
            pipeline_id: "00000000-0000-4000-8000-000000000012",
            probability: 25,
            forecast_category: "pipeline",
            status: "open",
          },
        ],
      };
    },
  };
  await assert.rejects(
    () =>
      updateCrmRecord(
        client,
        {
          organizationId: "00000000-0000-4000-8000-000000000000",
          userId: "00000000-0000-4000-8000-000000000001",
          activeCompanyId: "00000000-0000-4000-8000-000000000002",
          activeBranchId: "00000000-0000-4000-8000-000000000003",
          allowAllCompanies: false,
        },
        "opportunities",
        "00000000-0000-4000-8000-000000000010",
        { stageId: "00000000-0000-4000-8000-000000000099" },
      ),
    /governed opportunity stage action/,
  );
});


test("consent evidence is immutable", async () => {
  const client = {
    async query() {
      return {
        rows: [
          {
            id: "00000000-0000-4000-8000-000000000020",
            organization_id: "00000000-0000-4000-8000-000000000000",
            company_id: "00000000-0000-4000-8000-000000000002",
            channel: "email",
            purpose: "sales",
            action: "granted",
          },
        ],
      };
    },
  };
  await assert.rejects(
    () =>
      updateCrmRecord(
        client,
        {
          organizationId: "00000000-0000-4000-8000-000000000000",
          userId: "00000000-0000-4000-8000-000000000001",
          activeCompanyId: "00000000-0000-4000-8000-000000000002",
          activeBranchId: null,
          allowAllCompanies: false,
        },
        "consent-events",
        "00000000-0000-4000-8000-000000000020",
        { action: "withdrawn" },
      ),
    /immutable/,
  );
});

test("forecast submissions enforce governed status transitions", async () => {
  const client = {
    async query() {
      return {
        rows: [
          {
            id: "00000000-0000-4000-8000-000000000030",
            organization_id: "00000000-0000-4000-8000-000000000000",
            company_id: "00000000-0000-4000-8000-000000000002",
            status: "approved",
          },
        ],
      };
    },
  };
  await assert.rejects(
    () =>
      updateCrmRecord(
        client,
        {
          organizationId: "00000000-0000-4000-8000-000000000000",
          userId: "00000000-0000-4000-8000-000000000001",
          activeCompanyId: "00000000-0000-4000-8000-000000000002",
          activeBranchId: null,
          allowAllCompanies: false,
        },
        "forecast-submissions",
        "00000000-0000-4000-8000-000000000030",
        { status: "draft" },
      ),
    /cannot move from approved to draft/,
  );
});

test("CRM shared option parameters are explicitly typed", async () => {
  let calls = 0;
  const client = {
    async query(text, values) {
      assert.match(text, /\$1::uuid AS organization_id/);
      assert.match(text, /\$2::uuid AS active_company_id/);
      assert.match(text, /\$3::uuid AS active_branch_id/);
      assert.match(text, /\$4::boolean AS allow_all_companies/);
      assert.equal(values.length, 4);
      calls += 1;
      return { rows: [] };
    },
  };

  await getCrmOptions(client, {
    organizationId: "00000000-0000-4000-8000-000000000000",
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
  });
  assert.equal(calls, 31);
});

test("CRM report parameters are explicitly typed for every report shape", async () => {
  const client = {
    async query(text, values) {
      for (const marker of [
        /\$1::uuid AS organization_id/,
        /\$2::uuid AS active_company_id/,
        /\$3::uuid AS active_branch_id/,
        /\$4::boolean AS allow_all_companies/,
        /\$5::date AS date_from/,
        /\$6::date AS date_to/,
      ])
        assert.match(text, marker);
      assert.equal(values.length, 6);
      return { rows: [] };
    },
  };
  const context = {
    organizationId: "00000000-0000-4000-8000-000000000000",
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
  };

  for (const report of [
    "pipeline",
    "campaigns",
    "revenue-operations",
    "account-health",
    "privacy",
  ]) {
    await getCrmReport(client, context, report);
  }
});

test("CRM rejects owners outside the active organization", async () => {
  const client = {
    async query(text) {
      if (text.includes("UPDATE public.numbering_series")) {
        return { rows: [{ prefix: "LEAD-", number: 1, padding: 5 }] };
      }
      if (text.includes("crm_scoring_rules")) return { rows: [] };
      if (text.includes("organization_memberships")) return { rows: [] };
      throw new Error(`Unexpected query: ${text}`);
    },
  };

  await assert.rejects(
    () =>
      createCrmRecord(
        client,
        {
          organizationId: "00000000-0000-4000-8000-000000000000",
          userId: "00000000-0000-4000-8000-000000000001",
          activeCompanyId: "00000000-0000-4000-8000-000000000002",
          activeBranchId: null,
          allowAllCompanies: true,
        },
        "leads",
        {
          firstName: "Outside",
          ownerUserId: "00000000-0000-4000-8000-000000000099",
        },
      ),
    /active members of this organization/,
  );
});

test("CRM branch access fails closed without an authorized active branch", async () => {
  let sql = "";
  const restricted = {
    organizationId: "00000000-0000-4000-8000-000000000000",
    userId: "00000000-0000-4000-8000-000000000001",
    activeCompanyId: "00000000-0000-4000-8000-000000000002",
    activeBranchId: null,
    allowAllCompanies: false,
  };
  await listCrmRecords({ query: async (text) => ((sql = text), { rows: [] }) }, restricted, "leads");
  assert.match(sql, /AND false/);
  await assert.rejects(
    () => createCrmRecord({ query: async () => assert.fail("must not query") }, restricted, "activities", { subject: "Blocked" }),
    /allowed branch/,
  );
});

test("CRM writes reject unauthorized branches and cross-company input", async () => {
  const restricted = {
    organizationId: "00000000-0000-4000-8000-000000000000",
    userId: "00000000-0000-4000-8000-000000000001",
    activeCompanyId: "00000000-0000-4000-8000-000000000002",
    activeBranchId: "00000000-0000-4000-8000-000000000003",
    allowAllCompanies: false,
  };
  const client = { query: async () => assert.fail("must not query") };
  await assert.rejects(
    () => createCrmRecord(client, restricted, "activities", { subject: "Wrong branch", branchId: "00000000-0000-4000-8000-000000000099" }),
    /another branch/,
  );
  await assert.rejects(
    () => createCrmRecord(client, restricted, "activities", { subject: "Wrong company", companyId: "00000000-0000-4000-8000-000000000098" }),
    /another company/,
  );
});

test("CRM administrators retain cross-company and cross-branch access", async () => {
  let sql = "";
  await listCrmRecords(
    { query: async (text) => ((sql = text), { rows: [] }) },
    {
      organizationId: "00000000-0000-4000-8000-000000000000",
      userId: "00000000-0000-4000-8000-000000000001",
      activeCompanyId: null,
      activeBranchId: null,
      allowAllCompanies: true,
    },
    "leads",
  );
  assert.doesNotMatch(sql, /AND false/);
  assert.doesNotMatch(sql, /record\.company_id|record\.branch_id/);
});

test("CRM company-wide resources remain available without an active branch", async () => {
  let sql = "";
  await listCrmRecords(
    { query: async (text) => ((sql = text), { rows: [] }) },
    {
      organizationId: "00000000-0000-4000-8000-000000000000",
      userId: "00000000-0000-4000-8000-000000000001",
      activeCompanyId: "00000000-0000-4000-8000-000000000002",
      activeBranchId: null,
      allowAllCompanies: false,
    },
    "pipelines",
  );
  assert.doesNotMatch(sql, /AND false/);
  assert.match(sql, /record\.company_id/);
  assert.doesNotMatch(sql, /record\.branch_id/);
});
