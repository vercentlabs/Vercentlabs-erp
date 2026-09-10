import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  archiveCrmRecord,
  createCrmRecord,
  updateCrmRecord,
} from "../src/modules/crm/index.js";
import {
  createSalesStage,
  reorderSalesStages,
  setSalesStageActive,
  updateSalesStage,
} from "../src/modules/crm/opportunity-and-pipeline-governance/sales-stage-operations.js";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
const pipeline = "44444444-4444-4444-8444-444444444444";
const stage = "55555555-5555-4555-8555-555555555555";
const context = { organizationId: org, userId: user, activeCompanyId: company, activeBranchId: null, allowAllCompanies: false, roleSlugs: ["sales_manager"], permissions: ["crm.view", "crm.settings.manage", "crm.records.view_all"] };

function stageRow(overrides = {}) {
  return {
    id: stage,
    organization_id: org,
    pipeline_id: pipeline,
    pipeline_name: "Sales",
    pipeline_company_id: company,
    pipeline_status: "active",
    name: "Discovery",
    code: "DISCOVERY",
    sequence: 10,
    probability: "20.00",
    forecast_category: "pipeline",
    is_won: false,
    is_lost: false,
    stale_after_days: 14,
    status: "active",
    opportunity_count: 0,
    open_opportunity_count: 0,
    updated_at: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

function stageReader(row = stageRow(), extra = async (sql) => { throw new Error(`Unexpected query: ${sql}`); }) {
  return {
    async query(sql, values = []) {
      if (sql.includes("SELECT stage.*,pipeline.name AS pipeline_name")) return { rows: [row], rowCount: 1 };
      if (sql.includes("SELECT pipeline.* FROM tenant.crm_pipelines pipeline"))
        return { rows: [{ id: pipeline, organization_id: org, company_id: company, status: "active" }], rowCount: 1 };
      return extra(sql, values);
    },
  };
}

test("F012: generic stage mutation APIs are permanently closed", async () => {
  const noQuery = { query: async () => assert.fail("generic stage mutation must fail before SQL") };
  for (const call of [
    () => createCrmRecord(noQuery, context, "stages", { name: "Forged" }),
    () => updateCrmRecord(noQuery, context, "stages", stage, { name: "Forged" }),
    () => archiveCrmRecord(noQuery, context, "stages", stage),
  ]) {
    await assert.rejects(call, (error) => error.code === "CRM_SALES_STAGE_API_MOVED" && error.status === 410);
  }
});

test("F012: create validates pipeline, name, probability and governed fields before SQL", async () => {
  const noQuery = { query: async () => assert.fail("invalid create must fail before SQL") };
  await assert.rejects(() => createSalesStage(noQuery, context, { pipelineId: "bad", name: "Stage" }), (error) => error.code === "CRM_SALES_STAGE_PIPELINE_INVALID");
  await assert.rejects(() => createSalesStage(noQuery, context, { pipelineId: pipeline, name: "   " }), (error) => error.code === "CRM_SALES_STAGE_NAME_INVALID");
  await assert.rejects(() => createSalesStage(noQuery, context, { pipelineId: pipeline, name: "Stage", probability: 100.001 }), (error) => error.code === "CRM_SALES_STAGE_PROBABILITY_INVALID");
  await assert.rejects(() => createSalesStage(noQuery, context, { pipelineId: pipeline, name: "Stage", sequence: 99 }), (error) => error.code === "CRM_SALES_STAGE_GOVERNED_FIELD");
  await assert.rejects(() => createSalesStage(noQuery, context, { pipelineId: pipeline, name: "Stage", unexpected: true }), (error) => error.code === "CRM_SALES_STAGE_INPUT_INVALID");
});

test("F012: stale configuration updates fail before mutation", async () => {
  let writes = 0;
  const client = stageReader(stageRow(), async (sql) => {
    if (sql.includes("lower(btrim(name))")) return { rows: [] };
    if (/UPDATE|INSERT|DELETE/.test(sql)) writes += 1;
    throw new Error(`Unexpected query: ${sql}`);
  });
  await assert.rejects(
    () => updateSalesStage(client, context, stage, { name: "Discovery 2", expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }),
    (error) => error.code === "CRM_SALES_STAGE_STALE_WRITE",
  );
  assert.equal(writes, 0);
});

test("F012: a stage carrying open Opportunities cannot be deactivated", async () => {
  const client = stageReader(stageRow({ open_opportunity_count: 2, opportunity_count: 2 }));
  await assert.rejects(
    () => setSalesStageActive(client, context, stage, false, "2026-08-27T00:00:00.000Z"),
    (error) => error.code === "CRM_SALES_STAGE_OPEN_OPPORTUNITIES",
  );
});

test("F012: the last active Open stage cannot be deactivated", async () => {
  const client = stageReader(stageRow(), async (sql) => {
    if (sql.includes("SELECT count(*)::int AS count") && sql.includes("NOT is_won")) return { rows: [{ count: 0 }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  await assert.rejects(
    () => setSalesStageActive(client, context, stage, false, "2026-08-27T00:00:00.000Z"),
    (error) => error.code === "CRM_SALES_STAGE_OPEN_REQUIRED",
  );
});

test("F012: stage type cannot be changed after retained Opportunity use", async () => {
  const client = stageReader(stageRow({ opportunity_count: 3 }));
  await assert.rejects(
    () => updateSalesStage(client, context, stage, { stageType: "won", expectedUpdatedAt: "2026-08-27T00:00:00.000Z" }),
    (error) => error.code === "CRM_SALES_STAGE_TYPE_IN_USE",
  );
});

test("F012: Opportunity creation only resolves active non-terminal stages", () => {
  const source = read("services/api/src/modules/crm/opportunity-and-pipeline-governance/opportunity-validation.js");
  const start = source.indexOf("async function resolveOpportunityInitialStage");
  const end = source.indexOf("function opportunityScopeCompatible", start);
  const block = source.slice(start, end);
  assert.equal((block.match(/NOT s\.is_won AND NOT s\.is_lost/g) || []).length, 3);
  assert.match(block, /active Open stage/);
});

test("F012 migration hardens terminal semantics and creates immutable RLS history", () => {
  const migration = read("database/tenant/migrations/067_crm_sales_stages_f012.sql");
  assert.match(migration, /crm_pipeline_stages_code_nonblank_f012/);
  assert.match(migration, /LEGACY_/);
  assert.match(migration, /crm_pipeline_stages_won_semantics_f012/);
  assert.match(migration, /probability = 100 AND forecast_category = 'closed'/);
  assert.match(migration, /crm_pipeline_stages_lost_semantics_f012/);
  assert.match(migration, /probability = 0 AND forecast_category = 'closed'/);
  assert.match(migration, /crm_pipeline_stages_open_semantics_f012/);
  assert.match(migration, /forecast_category <> 'closed'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS tenant\.crm_sales_stage_configuration_history/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /crm_sales_stage_history_immutable_f012/);
});


test("F012: pipeline row is serialized before mutable stage locks", () => {
  const source = read("services/api/src/modules/crm/opportunity-and-pipeline-governance/sales-stage-operations.js");
  const update = source.slice(source.indexOf("export async function updateSalesStage"), source.indexOf("export async function setSalesStageActive"));
  const active = source.slice(source.indexOf("export async function setSalesStageActive"), source.indexOf("export async function reorderSalesStages"));
  for (const block of [update, active]) {
    assert.ok(block.indexOf("visiblePipeline(client, context, visible.pipelineId") < block.indexOf("getSalesStage(client, context, id, { lock: true })"));
  }
  assert.match(source, /Math\.abs\(value \* 100 - Math\.round\(value \* 100\)\) > 1e-9/);
});



test("F012: reorder parks active sequences before assigning the final unique order", async () => {
  const stageB = "66666666-6666-4666-8666-666666666666";
  const stageWon = "77777777-7777-4777-8777-777777777777";
  const rows = [
    stageRow({ id: stage, sequence: 10, updated_at: "2026-08-27T00:00:00.000Z" }),
    stageRow({ id: stageB, name: "Proposal", code: "PROPOSAL", sequence: 20, probability: "50.00", updated_at: "2026-08-27T00:00:00.000Z" }),
    stageRow({ id: stageWon, name: "Won", code: "WON", sequence: 30, probability: "100.00", forecast_category: "closed", is_won: true, stale_after_days: null, updated_at: "2026-08-27T00:00:00.000Z" }),
  ];
  const evidence = [];
  const client = {
    async query(sql, values = []) {
      if (sql.includes("SELECT pipeline.* FROM tenant.crm_pipelines pipeline"))
        return { rows: [{ id: pipeline, organization_id: org, company_id: company, status: "active" }], rowCount: 1 };
      if (sql.includes("FROM tenant.crm_pipeline_stages") && sql.includes("status='active'") && sql.includes("ORDER BY sequence,id FOR UPDATE"))
        return { rows: rows.map((row) => ({ ...row })), rowCount: rows.length };
      if (sql.startsWith("UPDATE tenant.crm_pipeline_stages SET sequence=$3")) {
        const target = Number(values[2]);
        const current = rows.find((row) => row.id === values[1]);
        assert.ok(current, "updated stage must exist");
        const collision = rows.some((row) => row.id !== current.id && row.status === "active" && Number(row.sequence) === target);
        if (collision) {
          const error = new Error("duplicate sequence");
          error.code = "23505";
          throw error;
        }
        current.sequence = target;
        if (sql.includes("updated_at=now()")) current.updated_at = "2026-08-27T00:01:00.000Z";
        return { rows: sql.includes("RETURNING *") ? [{ ...current }] : [], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO tenant.crm_sales_stage_configuration_history")) {
        evidence.push("history");
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) {
        evidence.push("outbox");
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("SELECT stage.*,pipeline.name AS pipeline_name")) {
        const listed = rows
          .slice()
          .sort((a, b) => Number(a.sequence) - Number(b.sequence))
          .map((row) => ({ ...row, pipeline_name: "Sales", pipeline_company_id: company, pipeline_status: "active", opportunity_count: 0, open_opportunity_count: 0 }));
        return { rows: listed, rowCount: listed.length };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const result = await reorderSalesStages(client, context, pipeline, [
    { id: stageB, expectedUpdatedAt: "2026-08-27T00:00:00.000Z" },
    { id: stage, expectedUpdatedAt: "2026-08-27T00:00:00.000Z" },
    { id: stageWon, expectedUpdatedAt: "2026-08-27T00:00:00.000Z" },
  ]);

  assert.equal(result.changed, true);
  assert.deepEqual(rows.slice().sort((a, b) => Number(a.sequence) - Number(b.sequence)).map((row) => row.id), [stageB, stage, stageWon]);
  assert.deepEqual(rows.map((row) => Number(row.sequence)).sort((a, b) => a - b), [10, 20, 30]);
  assert.equal(evidence.filter((value) => value === "history").length, 2);
  assert.equal(evidence.filter((value) => value === "outbox").length, 1);
});

test("F012 migration 068 scopes sequence uniqueness to active stages", () => {
  const migration = read("database/tenant/migrations/068_crm_sales_stage_active_order_f012.sql");
  assert.match(migration, /DROP CONSTRAINT IF EXISTS crm_pipeline_stages_organization_id_pipeline_id_sequence_key/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS crm_pipeline_stages_active_sequence_f012_uidx/);
  assert.match(migration, /WHERE status='active'/);
});


test("F012: new stage allocation appends instead of taking the first low free sequence", () => {
  const source = read("services/api/src/modules/crm/opportunity-and-pipeline-governance/sales-stage-operations.js");
  const create = source.slice(source.indexOf("export async function createSalesStage"), source.indexOf("export async function updateSalesStage"));
  const active = source.slice(source.indexOf("export async function setSalesStageActive"), source.indexOf("export async function reorderSalesStages"));
  assert.match(source, /function nextAppendSequence\(rows\)/);
  assert.match(source, /return \(values\.length \? Math\.max\(\.\.\.values\) : 0\) \+ 10/);
  assert.match(create, /temporarySequence = nextAppendSequence\(existingActive\)/);
  assert.match(active, /reusableOrAppendSequence\(activeRows, before\.sequence\)/);
  assert.doesNotMatch(source, /function firstUnusedSequence\(/);
});
