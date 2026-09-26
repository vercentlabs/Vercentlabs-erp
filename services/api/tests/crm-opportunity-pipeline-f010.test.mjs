import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { moveOpportunityStage } from "../src/modules/crm/index.js";

const root = path.resolve(import.meta.dirname, "../../..");
const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const branch = "33333333-3333-4333-8333-333333333333";
const user = "44444444-4444-4444-8444-444444444444";
const pipeline = "55555555-5555-4555-8555-555555555555";
const fromStage = "77777777-7777-4777-8777-777777777777";
const targetStage = "88888888-8888-4888-8888-888888888888";
const terminalStage = "99999999-9999-4999-8999-999999999999";
const reason = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const opportunity = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const updatedAt = "2026-08-27T00:00:00.000Z";

const context = {
  organizationId: org,
  userId: user,
  activeCompanyId: company,
  activeBranchId: branch,
  allowAllCompanies: false,
  roleSlugs: ["sales_representative"],
  permissions: ["crm.view", "crm.opportunities.manage"],
};

function row(overrides = {}) {
  return {
    id: opportunity,
    organization_id: org,
    company_id: company,
    branch_id: branch,
    pipeline_id: pipeline,
    stage_id: fromStage,
    owner_user_id: user,
    code: "OPP-00001",
    name: "F010 opportunity",
    amount: "1000.00",
    currency_code: "INR",
    probability: "20.00",
    forecast_category: "pipeline",
    status: "open",
    actual_close_date: null,
    outcome_reason_id: null,
    outcome_notes: null,
    lost_reason_id: null,
    loss_notes: null,
    updated_at: updatedAt,
    ...overrides,
  };
}

function movingClient({
  current = row(),
  stage = {
    id: targetStage,
    pipeline_id: pipeline,
    probability: "45.00",
    forecast_category: "best_case",
    is_won: false,
    is_lost: false,
  },
  reasonRow = null,
} = {}) {
  const calls = [];
  return {
    calls,
    client: {
      async query(sql, values = []) {
        calls.push({ sql, values });
        if (sql.startsWith("SELECT set_config('app.crm_opportunity_lifecycle_transition'"))
          return { rows: [] };
        if (sql.includes("FROM tenant.crm_opportunities record WHERE"))
          return { rows: [current] };
        if (sql.includes("FROM tenant.crm_pipeline_stages WHERE"))
          return { rows: stage ? [stage] : [] };
        if (sql.includes("FROM tenant.crm_lost_reasons"))
          return { rows: reasonRow ? [reasonRow] : [] };
        if (sql.includes("FROM tenant.crm_playbook_questions"))
          return { rows: [] };
        if (sql.startsWith("UPDATE tenant.crm_opportunities")) {
          const status = stage.is_won ? "won" : stage.is_lost ? "lost" : "open";
          return {
            rows: [
              row({
                stage_id: stage.id,
                probability: stage.probability,
                forecast_category: stage.forecast_category,
                status,
                updated_at: "2026-08-27T00:01:00.000Z",
                outcome_reason_id:
                  status === "won" || status === "lost" ? values[4] : null,
                outcome_notes:
                  status === "won" || status === "lost" ? values[5] : null,
              }),
            ],
          };
        }
        if (sql.includes("INSERT INTO tenant.crm_opportunity_stage_history"))
          return { rows: [] };
        if (sql.includes("INSERT INTO tenant.crm_opportunity_probability_history"))
          return { rows: [] };
        if (sql.includes("FROM tenant.crm_automation_rules")) return { rows: [] };
        if (sql.includes("INSERT INTO tenant.platform_events")) return { rows: [] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
  };
}

test("F010: canonical move is record-scoped, locked, same-pipeline and auditable through history/outbox", async () => {
  const { client, calls } = movingClient();
  const moved = await moveOpportunityStage(
    client,
    context,
    opportunity,
    targetStage,
    "Move from pipeline",
    { expectedUpdatedAt: updatedAt, expectedStageId: fromStage },
  );
  assert.equal(moved.stageId, targetStage);
  assert.equal(moved.status, "open");
  const lockedRead = calls.find((call) =>
    call.sql.includes("FROM tenant.crm_opportunities record WHERE"),
  );
  assert.match(lockedRead.sql, /FOR UPDATE/);
  assert.match(lockedRead.sql, /company_id/);
  assert.match(lockedRead.sql, /branch_id/);
  assert.match(lockedRead.sql, /owner_user_id/);
  const stageLookup = calls.find((call) =>
    call.sql.includes("FROM tenant.crm_pipeline_stages WHERE"),
  );
  assert.deepEqual(stageLookup.values, [org, targetStage, pipeline]);
  assert.equal(
    calls.filter((call) =>
      call.sql.includes("INSERT INTO tenant.crm_opportunity_stage_history"),
    ).length,
    1,
  );
  const outbox = calls.find((call) =>
    call.sql.includes("INSERT INTO tenant.platform_events"),
  );
  assert.equal(outbox.values[1], "crm.opportunity.stage_changed");
  assert.deepEqual(outbox.values[4], {
    fromStageId: fromStage,
    toStageId: targetStage,
    status: "open",
  });
});

test("F010: stale and already-moved records fail before any write", async () => {
  const stale = movingClient();
  await assert.rejects(
    () =>
      moveOpportunityStage(stale.client, context, opportunity, targetStage, null, {
        expectedUpdatedAt: "2026-08-26T23:59:00.000Z",
        expectedStageId: fromStage,
      }),
    (error) => error.code === "CRM_STALE_WRITE",
  );
  assert.equal(
    stale.calls.some((call) => call.sql.startsWith("UPDATE tenant.crm_opportunities")),
    false,
  );

  const conflict = movingClient();
  await assert.rejects(
    () =>
      moveOpportunityStage(conflict.client, context, opportunity, targetStage, null, {
        expectedUpdatedAt: updatedAt,
        expectedStageId: targetStage,
      }),
    (error) => error.code === "CRM_STAGE_CONFLICT",
  );
});

test("F010: same-stage replay is a mutation-free no-op", async () => {
  const { client, calls } = movingClient();
  const replay = await moveOpportunityStage(
    client,
    context,
    opportunity,
    fromStage,
    "duplicate action",
    { expectedUpdatedAt: updatedAt, expectedStageId: fromStage },
  );
  assert.equal(replay.stageId, fromStage);
  assert.equal(calls.length, 1);
  assert.equal(
    calls.some((call) => call.sql.includes("crm_opportunity_stage_history")),
    false,
  );
  assert.equal(
    calls.some((call) => call.sql.includes("platform_events")),
    false,
  );
});

test("F010: cross-pipeline destination is blocked and archived opportunities stay permanently read-only", async () => {
  const wrongPipeline = movingClient({ stage: null });
  await assert.rejects(
    () =>
      moveOpportunityStage(
        wrongPipeline.client,
        context,
        opportunity,
        targetStage,
        null,
        { expectedUpdatedAt: updatedAt, expectedStageId: fromStage },
      ),
    /selected stage is not part of this opportunity pipeline/i,
  );

  const archived = movingClient({ current: row({ status: "archived" }) });
  await assert.rejects(
    () =>
      moveOpportunityStage(archived.client, context, opportunity, targetStage, null, {
        expectedUpdatedAt: updatedAt,
        expectedStageId: fromStage,
      }),
    (error) => error.code === "CRM_OPPORTUNITY_ARCHIVED",
  );
  assert.equal(archived.calls.length, 1);
});

test("F009: a closed opportunity can only be reopened into an open stage, and only with a reason", async () => {
  const noReason = movingClient({ current: row({ status: "won" }) });
  await assert.rejects(
    () =>
      moveOpportunityStage(noReason.client, context, opportunity, targetStage, null, {
        expectedUpdatedAt: updatedAt,
        expectedStageId: fromStage,
      }),
    (error) => error.code === "CRM_OPPORTUNITY_REOPEN_REASON_REQUIRED" && error.status === 400,
  );

  const backIntoTerminal = movingClient({
    current: row({ status: "won" }),
    stage: {
      id: terminalStage,
      pipeline_id: pipeline,
      probability: "0.00",
      forecast_category: "closed",
      is_won: false,
      is_lost: true,
    },
  });
  await assert.rejects(
    () =>
      moveOpportunityStage(
        backIntoTerminal.client,
        context,
        opportunity,
        terminalStage,
        "Reopening to reclose as lost",
        { expectedUpdatedAt: updatedAt, expectedStageId: fromStage },
      ),
    (error) => error.code === "CRM_OPPORTUNITY_REOPEN_TARGET_INVALID",
  );
});

test("F009: a reopened opportunity clears its prior outcome and preserves the close event in stage history", async () => {
  const reopened = movingClient({
    current: row({
      status: "won",
      stage_id: terminalStage,
      actual_close_date: "2026-08-20",
      outcome_reason_id: reason,
      outcome_notes: "Signed contract",
    }),
  });
  const record = await moveOpportunityStage(
    reopened.client,
    context,
    opportunity,
    targetStage,
    "Customer requested renegotiation",
    { expectedUpdatedAt: updatedAt, expectedStageId: terminalStage },
  );
  assert.equal(record.status, "open");
  assert.equal(record.stageId, targetStage);
  const history = reopened.calls.find((call) =>
    call.sql.includes("INSERT INTO tenant.crm_opportunity_stage_history"),
  );
  assert.equal(history.values.at(-4), "open");
  const reopenEvent = reopened.calls.find(
    (call) => call.sql.includes("INSERT INTO tenant.platform_events") && call.values[1] === "crm.opportunity.reopened",
  );
  assert.equal(reopenEvent.values[4].previousStatus, "won");
  assert.equal(reopenEvent.values[4].previousOutcomeReasonId, reason);
  assert.equal(reopenEvent.values[4].reopenReason, "Customer requested renegotiation");
});

test("F010: terminal stages require a compatible governed outcome reason", async () => {
  const terminal = {
    id: terminalStage,
    pipeline_id: pipeline,
    probability: "100.00",
    forecast_category: "closed",
    is_won: true,
    is_lost: false,
  };
  const missing = movingClient({ stage: terminal });
  await assert.rejects(
    () =>
      moveOpportunityStage(
        missing.client,
        context,
        opportunity,
        terminalStage,
        null,
        { expectedUpdatedAt: updatedAt, expectedStageId: fromStage },
      ),
    (error) => error.code === "CRM_OUTCOME_REASON_REQUIRED",
  );

  const valid = movingClient({
    stage: terminal,
    reasonRow: { id: reason, outcome_type: "won" },
  });
  const won = await moveOpportunityStage(
    valid.client,
    context,
    opportunity,
    terminalStage,
    "Customer selected Vercentlabs",
    {
      expectedUpdatedAt: updatedAt,
      expectedStageId: fromStage,
      outcomeReasonId: reason,
      outcomeNotes: "Customer selected Vercentlabs",
    },
  );
  assert.equal(won.status, "won");
  assert.equal(won.outcomeReasonId, reason);
  const terminalUpdate = valid.calls.find((call) =>
    call.sql.startsWith("UPDATE tenant.crm_opportunities"),
  );
  assert.ok(terminalUpdate, "terminal stage move must issue the canonical Opportunity update");
  assert.match(
    terminalUpdate.sql,
    /outcome_reason_id = CASE WHEN \$4 IN \('won','lost'\) THEN \$5::uuid ELSE NULL::uuid END/,
  );
  assert.match(
    terminalUpdate.sql,
    /lost_reason_id = CASE WHEN \$4='lost' THEN \$5::uuid ELSE NULL::uuid END/,
  );
});

test("F010: existing schema already owns pipelines, stages, history and stage/pipeline integrity", () => {
  const migrationDirectory = path.join(root, "database/tenant/migrations");
  const migrations = fs
    .readdirSync(migrationDirectory)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => fs.readFileSync(path.join(migrationDirectory, file), "utf8"))
    .join("\n");
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS tenant\.crm_pipelines/);
  assert.match(migrations, /CREATE TABLE IF NOT EXISTS tenant\.crm_pipeline_stages/);
  assert.match(
    migrations,
    /CREATE TABLE IF NOT EXISTS tenant\.crm_opportunity_stage_history/,
  );
  const f009 = fs.readFileSync(
    path.join(migrationDirectory, "065_crm_opportunities_f009.sql"),
    "utf8",
  );
  assert.match(f009, /FOREIGN KEY \(organization_id,pipeline_id,stage_id\)/);
  assert.match(f009, /crm_opportunities_stage_pipeline_f009_fkey/);
});
