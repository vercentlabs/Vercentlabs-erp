import assert from "node:assert/strict";
import test from "node:test";

import { moveOpportunityStage, updateOpportunityProbability } from "../src/modules/crm/index.js";

// Integrity closeout (Prompts 1-5): moveOpportunityStage changes
// probability (adopting the destination stage's configured default, or
// forcing 0/100 on Won/Lost/reopen) but never wrote a
// crm_opportunity_probability_history row — an Opportunity moved through
// several stages showed zero probability history unless a manual override
// also happened separately. Migration 099 adds an explicit `source` column
// so every entry (manual_override / stage_default / terminal_won /
// terminal_lost / reopen) declares its own provenance, matching the
// dossier's requirement to distinguish "stage default" from "manual
// override" without conflating them.

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const branch = "33333333-3333-4333-8333-333333333333";
const user = "44444444-4444-4444-8444-444444444444";
const pipeline = "55555555-5555-4555-8555-555555555555";
const fromStage = "77777777-7777-4777-8777-777777777777";
const targetStage = "88888888-8888-4888-8888-888888888888";
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

function opportunityRow(overrides = {}) {
  return {
    id: opportunity,
    organization_id: org,
    company_id: company,
    branch_id: branch,
    pipeline_id: pipeline,
    stage_id: fromStage,
    owner_user_id: user,
    code: "OPP-00001",
    name: "F011 opportunity",
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

function movingClient({ current = opportunityRow(), stage, reasonRow = null } = {}) {
  const queries = [];
  return {
    queries,
    client: {
      async query(sql, values = []) {
        queries.push({ sql, values });
        if (sql.startsWith("SELECT set_config('app.crm_opportunity_lifecycle_transition'")) return { rows: [] };
        if (sql.includes("FROM tenant.crm_opportunities record WHERE")) return { rows: [current] };
        if (sql.includes("FROM tenant.crm_pipeline_stages WHERE")) return { rows: stage ? [stage] : [] };
        if (sql.includes("FROM tenant.crm_lost_reasons")) return { rows: reasonRow ? [reasonRow] : [] };
        if (sql.includes("FROM tenant.crm_playbook_questions")) return { rows: [] };
        if (sql.startsWith("UPDATE tenant.crm_opportunities")) {
          const status = stage.is_won ? "won" : stage.is_lost ? "lost" : "open";
          return {
            rows: [
              opportunityRow({
                stage_id: stage.id,
                probability: stage.probability,
                forecast_category: stage.forecast_category,
                status,
                updated_at: "2026-08-27T00:01:00.000Z",
                outcome_reason_id: status === "won" || status === "lost" ? values[4] : null,
                outcome_notes: status === "won" || status === "lost" ? values[5] : null,
              }),
            ],
          };
        }
        if (sql.includes("INSERT INTO tenant.crm_opportunity_stage_history")) return { rows: [] };
        if (sql.includes("FROM tenant.crm_automation_rules")) return { rows: [] };
        if (sql.includes("INSERT INTO tenant.platform_events")) return { rows: [] };
        if (sql.includes("INSERT INTO tenant.crm_opportunity_probability_history")) return { rows: [] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
  };
}

test("moveOpportunityStage: an ordinary transition that changes probability writes a probability-history row with source='stage_default'", async () => {
  const { client, queries } = movingClient({
    stage: { id: targetStage, pipeline_id: pipeline, probability: "45.00", forecast_category: "best_case", is_won: false, is_lost: false },
  });
  await moveOpportunityStage(client, context, opportunity, targetStage, "Moving forward", { expectedUpdatedAt: updatedAt, expectedStageId: fromStage });
  const historyInsert = queries.find((q) => q.sql.includes("INSERT INTO tenant.crm_opportunity_probability_history"));
  assert.ok(historyInsert, "expected a probability-history INSERT for this stage move");
  assert.ok(historyInsert.values.includes("stage_default"), "source must be stage_default for an ordinary transition");
  assert.ok(historyInsert.values.includes(20), "from_probability must be the prior probability");
  assert.ok(historyInsert.values.includes(45), "to_probability must be the destination stage's default");
});

test("moveOpportunityStage: marking an Opportunity Won writes source='terminal_won'", async () => {
  const { client, queries } = movingClient({
    stage: { id: targetStage, pipeline_id: pipeline, probability: "100.00", forecast_category: "closed", is_won: true, is_lost: false },
    reasonRow: { id: "reason-1", name: "Great fit", outcome_type: "won" },
  });
  await moveOpportunityStage(client, context, opportunity, targetStage, "Closed the deal", {
    expectedUpdatedAt: updatedAt,
    expectedStageId: fromStage,
    outcomeReasonId: "reason-1",
  });
  const historyInsert = queries.find((q) => q.sql.includes("INSERT INTO tenant.crm_opportunity_probability_history"));
  assert.ok(historyInsert.values.includes("terminal_won"));
});

test("moveOpportunityStage: marking an Opportunity Lost writes source='terminal_lost'", async () => {
  const { client, queries } = movingClient({
    stage: { id: targetStage, pipeline_id: pipeline, probability: "0.00", forecast_category: "closed", is_won: false, is_lost: true },
    reasonRow: { id: "reason-2", name: "Budget", outcome_type: "lost" },
  });
  await moveOpportunityStage(client, context, opportunity, targetStage, "Lost the deal", {
    expectedUpdatedAt: updatedAt,
    expectedStageId: fromStage,
    outcomeReasonId: "reason-2",
  });
  const historyInsert = queries.find((q) => q.sql.includes("INSERT INTO tenant.crm_opportunity_probability_history"));
  assert.ok(historyInsert.values.includes("terminal_lost"));
});

test("moveOpportunityStage: reopening a closed Opportunity writes source='reopen'", async () => {
  const { client, queries } = movingClient({
    current: opportunityRow({ status: "lost", stage_id: "closed-lost-stage", probability: "0.00" }),
    stage: { id: targetStage, pipeline_id: pipeline, probability: "30.00", forecast_category: "pipeline", is_won: false, is_lost: false },
  });
  await moveOpportunityStage(client, context, opportunity, targetStage, "Reopening — new budget approved", {
    expectedUpdatedAt: updatedAt,
    expectedStageId: "closed-lost-stage",
  });
  const historyInsert = queries.find((q) => q.sql.includes("INSERT INTO tenant.crm_opportunity_probability_history"));
  assert.ok(historyInsert.values.includes("reopen"));
});

test("moveOpportunityStage: no probability-history row is written when the destination stage's probability equals the current one (no real change)", async () => {
  const { client, queries } = movingClient({
    current: opportunityRow({ probability: "45.00" }),
    stage: { id: targetStage, pipeline_id: pipeline, probability: "45.00", forecast_category: "best_case", is_won: false, is_lost: false },
  });
  await moveOpportunityStage(client, context, opportunity, targetStage, null, { expectedUpdatedAt: updatedAt, expectedStageId: fromStage });
  const historyInsert = queries.find((q) => q.sql.includes("INSERT INTO tenant.crm_opportunity_probability_history"));
  assert.equal(historyInsert, undefined, "no history row should be written for a no-op probability change");
});

test("updateOpportunityProbability: a manual override writes source='manual_override'", async () => {
  const queries = [];
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.startsWith("SELECT set_config('app.crm_opportunity_lifecycle_transition'")) return { rows: [] };
      if (sql.includes("FROM tenant.crm_opportunities record WHERE"))
        return { rows: [opportunityRow({ probability: "20.00" })] };
      if (sql.startsWith("UPDATE tenant.crm_opportunities"))
        return { rows: [opportunityRow({ probability: "65.00", updated_at: "2026-08-27T00:01:00.000Z" })] };
      if (sql.includes("INSERT INTO tenant.crm_opportunity_probability_history")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.platform_events")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await updateOpportunityProbability(client, context, opportunity, 65, "Deal is heating up", {
    expectedUpdatedAt: updatedAt,
    expectedProbability: 20,
  });
  const historyInsert = queries.find((q) => q.sql.includes("INSERT INTO tenant.crm_opportunity_probability_history"));
  assert.ok(historyInsert, "expected a probability-history INSERT");
  assert.match(historyInsert.sql, /'manual_override'/, "manual override source must be a literal, not attacker-influenced input");
});
