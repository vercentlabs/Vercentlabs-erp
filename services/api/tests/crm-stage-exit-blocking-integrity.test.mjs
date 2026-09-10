import assert from "node:assert/strict";
import test from "node:test";

import { moveOpportunityStage } from "../src/modules/crm/index.js";

// Integrity closeout (Prompts 1-5): crm_playbook_questions already had a
// real blocks_stage_exit flag (Prompt 1 schema) — the dossier's F012
// stage-level "required fields/guidance" requirement — but no code
// anywhere enforced it. A question marked blocks_stage_exit=true did
// nothing at all; Opportunities could leave the stage with zero required
// questions answered. moveOpportunityStage now checks for unanswered
// blocking questions on the ORIGIN stage before committing the transition.

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
    name: "F012 opportunity",
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

function movingClient({ playbookQuestions = [] } = {}) {
  const queries = [];
  const stage = { id: targetStage, pipeline_id: pipeline, probability: "45.00", forecast_category: "best_case", is_won: false, is_lost: false };
  return {
    queries,
    client: {
      async query(sql, values = []) {
        queries.push({ sql, values });
        if (sql.startsWith("SELECT set_config('app.crm_opportunity_lifecycle_transition'")) return { rows: [] };
        if (sql.includes("FROM tenant.crm_opportunities record WHERE")) return { rows: [opportunityRow()] };
        if (sql.includes("FROM tenant.crm_pipeline_stages WHERE")) return { rows: [stage] };
        if (sql.includes("FROM tenant.crm_playbook_questions")) return { rows: playbookQuestions };
        if (sql.startsWith("UPDATE tenant.crm_opportunities"))
          return { rows: [opportunityRow({ stage_id: targetStage, probability: stage.probability, updated_at: "2026-08-27T00:01:00.000Z" })] };
        if (sql.includes("INSERT INTO tenant.crm_opportunity_stage_history")) return { rows: [] };
        if (sql.includes("INSERT INTO tenant.crm_opportunity_probability_history")) return { rows: [] };
        if (sql.includes("FROM tenant.crm_automation_rules")) return { rows: [] };
        if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
  };
}

test("moveOpportunityStage: a transition with no configured blocking questions succeeds normally", async () => {
  const { client } = movingClient({ playbookQuestions: [] });
  await assert.doesNotReject(
    moveOpportunityStage(client, context, opportunity, targetStage, null, { expectedUpdatedAt: updatedAt, expectedStageId: fromStage }),
  );
});

test("moveOpportunityStage: an unanswered blocking question rejects the transition with CRM_OPPORTUNITY_STAGE_EXIT_BLOCKED (409) and names the missing requirement", async () => {
  const { client } = movingClient({
    playbookQuestions: [{ id: "question-1", prompt: "Who is the economic buyer?" }],
  });
  await assert.rejects(
    moveOpportunityStage(client, context, opportunity, targetStage, null, { expectedUpdatedAt: updatedAt, expectedStageId: fromStage }),
    (error) =>
      error.status === 409 &&
      error.code === "CRM_OPPORTUNITY_STAGE_EXIT_BLOCKED" &&
      Array.isArray(error.details?.missingRequirements) &&
      error.details.missingRequirements.includes("Who is the economic buyer?"),
  );
});

test("moveOpportunityStage: the blocking-question check is scoped to the origin stage the Opportunity is actually leaving", async () => {
  const { client, queries } = movingClient({ playbookQuestions: [] });
  await moveOpportunityStage(client, context, opportunity, targetStage, null, { expectedUpdatedAt: updatedAt, expectedStageId: fromStage });
  const blockingQuery = queries.find((q) => q.sql.includes("FROM tenant.crm_playbook_questions"));
  assert.ok(blockingQuery, "expected a playbook-questions check");
  assert.ok(blockingQuery.values.includes(fromStage), "must check the stage being left, not the destination stage");
});

test("moveOpportunityStage: the block only applies to active, blocks_stage_exit questions (enforced in SQL, not in application code)", async () => {
  const { client, queries } = movingClient({ playbookQuestions: [] });
  await moveOpportunityStage(client, context, opportunity, targetStage, null, { expectedUpdatedAt: updatedAt, expectedStageId: fromStage });
  const blockingQuery = queries.find((q) => q.sql.includes("FROM tenant.crm_playbook_questions"));
  assert.match(blockingQuery.sql, /blocks_stage_exit = true/);
  assert.match(blockingQuery.sql, /status = 'active'/);
});
