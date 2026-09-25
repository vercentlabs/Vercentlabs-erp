import assert from "node:assert/strict";
import test from "node:test";

import {
  listOpportunityStageBottlenecks,
  listStageSlaPolicies,
  upsertStageSlaPolicy,
} from "../src/modules/crm/opportunity-and-pipeline-governance/stage-aging.js";

// F010 gap-closure (benchmark: "Opportunity pipeline management in top
// ERPs" report) — the Pipeline board had no bottleneck/funnel signal
// anywhere, and crm_opportunity_stage_sla_policies had no create/update
// path despite being read live by the dashboard's stalled count and the
// Opportunity list's stalled=true filter. These three functions close both
// gaps: a stage-level average-age/breach aggregate, and a governed upsert
// for the SLA policy table keyed by its own natural key.

const org = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const myCompany = "44444444-4444-4444-8444-444444444444";
const pipelineId = "55555555-5555-4555-8555-555555555555";
const stageId = "66666666-6666-4666-8666-666666666666";

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

test("listOpportunityStageBottlenecks: applies the real Opportunity record scope, not just organization_id", async () => {
  const client = mockClient([]);
  await listOpportunityStageBottlenecks(client, restrictedContext, pipelineId);
  const query = client.queries[0];
  assert.match(query.sql, /o\.company_id/, "must apply company scope to the opportunity join");
  assert.ok(query.values.includes(myCompany), "the caller's active company must be bound");
});

test("listOpportunityStageBottlenecks: is not bounded by any LIMIT — a real unbounded aggregate", async () => {
  const client = mockClient([]);
  await listOpportunityStageBottlenecks(client, restrictedContext, pipelineId);
  assert.doesNotMatch(client.queries[0].sql, /LIMIT/i);
});

test("listOpportunityStageBottlenecks: returns [] without querying when no pipeline is selected", async () => {
  const client = mockClient([]);
  const rows = await listOpportunityStageBottlenecks(client, restrictedContext, null);
  assert.deepEqual(rows, []);
  assert.equal(client.queries.length, 0);
});

test("listOpportunityStageBottlenecks: flags a stage as a bottleneck when its average age has already breached the effective SLA", async () => {
  const client = mockClient([
    { stage_id: stageId, name: "Negotiation", sequence: 3, maximum_days: "14", opportunity_count: 5, average_age_days: "18.5", breached_count: 2 },
  ]);
  const [row] = await listOpportunityStageBottlenecks(client, restrictedContext, pipelineId);
  assert.equal(row.isBottleneck, true);
  assert.equal(row.averageAgeDays, 18.5);
  assert.equal(row.breachedCount, 2);
  assert.equal(row.maximumDays, 14);
});

test("listOpportunityStageBottlenecks: does not flag an empty stage even if it has a low SLA (no false positive on a healthy pipeline)", async () => {
  const client = mockClient([
    { stage_id: stageId, name: "Qualification", sequence: 1, maximum_days: "7", opportunity_count: 0, average_age_days: "0", breached_count: 0 },
  ]);
  const [row] = await listOpportunityStageBottlenecks(client, restrictedContext, pipelineId);
  assert.equal(row.isBottleneck, false);
});

test("listOpportunityStageBottlenecks: does not flag a stage under its SLA on average with zero breached deals", async () => {
  const client = mockClient([
    { stage_id: stageId, name: "Proposal", sequence: 2, maximum_days: "14", opportunity_count: 8, average_age_days: "6.2", breached_count: 0 },
  ]);
  const [row] = await listOpportunityStageBottlenecks(client, restrictedContext, pipelineId);
  assert.equal(row.isBottleneck, false);
});

test("listOpportunityStageBottlenecks: a stage with no configured SLA at all (maximum_days null) is flagged only by a real breached count, never by average age alone", async () => {
  const client = mockClient([
    { stage_id: stageId, name: "Discovery", sequence: 1, maximum_days: null, opportunity_count: 3, average_age_days: "40.0", breached_count: 0 },
  ]);
  const [row] = await listOpportunityStageBottlenecks(client, restrictedContext, pipelineId);
  assert.equal(row.isBottleneck, false);
  assert.equal(row.maximumDays, null);
});

test("listStageSlaPolicies: returns [] without querying when no pipeline is selected", async () => {
  const client = mockClient([]);
  const rows = await listStageSlaPolicies(client, restrictedContext, null);
  assert.deepEqual(rows, []);
  assert.equal(client.queries.length, 0);
});

test("listStageSlaPolicies: left-joins every active stage against its (possibly absent) policy row", async () => {
  const client = mockClient([
    { stage_id: stageId, name: "Proposal", sequence: 2, stale_after_days: 21, policy_id: null, maximum_days: null, policy_status: null, policy_updated_at: null },
  ]);
  const rows = await listStageSlaPolicies(client, restrictedContext, pipelineId);
  assert.match(client.queries[0].sql, /LEFT JOIN tenant\.crm_opportunity_stage_sla_policies/);
  assert.equal(rows[0].fallbackDays, 21);
  assert.equal(rows[0].overrideDays, null);
  assert.equal(rows[0].policyId, null);
});

test("upsertStageSlaPolicy: requires a pipeline and stage", async () => {
  const client = mockClient([]);
  await assert.rejects(
    () => upsertStageSlaPolicy(client, restrictedContext, { pipelineId: "", stageId: "", maximumDays: 14 }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "CRM_STAGE_SLA_POLICY_INPUT_INVALID");
      return true;
    },
  );
});

test("upsertStageSlaPolicy: activating a policy requires a maximum-days value", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_pipeline_stages")) return { rows: [{ id: stageId }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () => upsertStageSlaPolicy(client, restrictedContext, { pipelineId, stageId, status: "active" }),
    (error) => {
      assert.equal(error.code, "CRM_STAGE_SLA_POLICY_INVALID_DAYS");
      return true;
    },
  );
});

test("upsertStageSlaPolicy: maximum days must be between 1 and 3650", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_pipeline_stages")) return { rows: [{ id: stageId }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () => upsertStageSlaPolicy(client, restrictedContext, { pipelineId, stageId, maximumDays: 4000, status: "active" }),
    (error) => {
      assert.equal(error.code, "CRM_STAGE_SLA_POLICY_INVALID_DAYS");
      return true;
    },
  );
});

test("upsertStageSlaPolicy: 404s when the stage does not belong to the given pipeline", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_pipeline_stages")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () => upsertStageSlaPolicy(client, restrictedContext, { pipelineId, stageId, maximumDays: 14, status: "active" }),
    (error) => {
      assert.equal(error.status, 404);
      assert.equal(error.code, "CRM_STAGE_SLA_POLICY_STAGE_NOT_FOUND");
      return true;
    },
  );
});

test("upsertStageSlaPolicy: a stale expectedUpdatedAt against an existing policy is rejected", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_pipeline_stages")) return { rows: [{ id: stageId }] };
      if (sql.includes("FROM tenant.crm_opportunity_stage_sla_policies WHERE"))
        return { rows: [{ id: "policy-1", updated_at: "2026-08-01T00:00:00.000Z" }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () =>
      upsertStageSlaPolicy(client, restrictedContext, {
        pipelineId,
        stageId,
        maximumDays: 10,
        status: "active",
        expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
      }),
    (error) => {
      assert.equal(error.code, "CRM_STALE_WRITE");
      return true;
    },
  );
});

test("upsertStageSlaPolicy: upserts by the table's own natural key (organization, pipeline, stage), not a caller-supplied id", async () => {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes("FROM tenant.crm_pipeline_stages")) return { rows: [{ id: stageId }] };
      if (sql.includes("FROM tenant.crm_opportunity_stage_sla_policies WHERE")) return { rows: [] };
      if (sql.startsWith("INSERT INTO tenant.crm_opportunity_stage_sla_policies"))
        return { rows: [{ id: "policy-1", organization_id: org, pipeline_id: pipelineId, stage_id: stageId, maximum_days: 10, status: "active" }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await upsertStageSlaPolicy(client, restrictedContext, { pipelineId, stageId, maximumDays: 10, status: "active" });
  const insert = queries.find((q) => q.sql.startsWith("INSERT INTO tenant.crm_opportunity_stage_sla_policies"));
  assert.match(insert.sql, /ON CONFLICT \(organization_id, pipeline_id, stage_id\) DO UPDATE/);
  assert.equal(result.maximumDays, 10);
  assert.equal(result.status, "active");
});

test("upsertStageSlaPolicy: deactivating (clearing an override) does not require a maximum-days value", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.crm_pipeline_stages")) return { rows: [{ id: stageId }] };
      if (sql.includes("FROM tenant.crm_opportunity_stage_sla_policies WHERE"))
        return { rows: [{ id: "policy-1", updated_at: "2026-08-01T00:00:00.000Z" }] };
      if (sql.startsWith("INSERT INTO tenant.crm_opportunity_stage_sla_policies"))
        return { rows: [{ id: "policy-1", status: "inactive", maximum_days: 14 }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await upsertStageSlaPolicy(client, restrictedContext, {
    pipelineId,
    stageId,
    status: "inactive",
    expectedUpdatedAt: "2026-08-01T00:00:00.000Z",
  });
  assert.equal(result.status, "inactive");
});
