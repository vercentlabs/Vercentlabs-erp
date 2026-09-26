import assert from "node:assert/strict";
import test from "node:test";

import { restoreOpportunity } from "../src/modules/crm/index.js";

// F009 gap-closure (benchmark: "Opportunity management in top ERPs" report)
// — every one of the 7 competitors reviewed treats a closed deal as
// reversible; Archived was Vercentlabs's one true dead end (moveOpportunity
// Stage's own reopen path only ever operates on Won/Lost stages, never on
// the generic archive/soft-delete action's status='archived'). restoreOpportunity
// mirrors that reopen contract: a reason is required, prior state is
// preserved in history rather than overwritten, and the same governed
// session-flag mechanism (migration 098) is reused, never a parallel write path.

const org = "11111111-1111-4111-8111-111111111111";
const company = "22222222-2222-4222-8222-222222222222";
const branch = "33333333-3333-4333-8333-333333333333";
const user = "44444444-4444-4444-8444-444444444444";
const pipeline = "55555555-5555-4555-8555-555555555555";
const archivedFromStage = "77777777-7777-4777-8777-777777777777";
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
    stage_id: archivedFromStage,
    owner_user_id: user,
    code: "OPP-00001",
    name: "F009 opportunity",
    amount: "1000.00",
    currency_code: "INR",
    probability: "0.00",
    forecast_category: "closed",
    status: "archived",
    actual_close_date: "2026-08-01",
    outcome_reason_id: "reason-1",
    outcome_notes: "Went quiet",
    lost_reason_id: "reason-1",
    loss_notes: "Went quiet",
    updated_at: updatedAt,
    ...overrides,
  };
}

function restoringClient({ current = opportunityRow(), currentStage, fallbackStage } = {}) {
  // `current: null` (not `undefined`) simulates "not found" — a destructured
  // default only substitutes for `undefined`, so passing `null` explicitly
  // is required to actually reach the empty-rows branch below.
  const queries = [];
  return {
    queries,
    client: {
      async query(sql, values = []) {
        queries.push({ sql, values });
        if (sql.startsWith("SELECT set_config('app.crm_opportunity_lifecycle_transition'")) return { rows: [] };
        if (sql.includes("FROM tenant.crm_opportunities record WHERE")) return { rows: current ? [current] : [] };
        // The "still active, non-terminal, same-stage" lookup binds the
        // opportunity's own stage_id as $2 — distinguish it from the
        // pipeline-wide fallback lookup (no stage_id parameter) by param count.
        if (sql.includes("FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND id=$2 AND pipeline_id=$3"))
          return { rows: currentStage ? [currentStage] : [] };
        if (sql.includes("FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND pipeline_id=$2 AND status='active'"))
          return { rows: fallbackStage ? [fallbackStage] : [] };
        if (sql.startsWith("UPDATE tenant.crm_opportunities")) {
          const [stageId, probability, forecastCategory] = values;
          return {
            rows: [
              opportunityRow({
                stage_id: stageId,
                probability,
                forecast_category: forecastCategory,
                status: "open",
                actual_close_date: null,
                outcome_reason_id: null,
                outcome_notes: null,
                lost_reason_id: null,
                loss_notes: null,
                updated_at: "2026-08-27T00:01:00.000Z",
              }),
            ],
          };
        }
        if (sql.includes("INSERT INTO tenant.crm_opportunity_stage_history")) return { rows: [] };
        if (sql.includes("INSERT INTO tenant.crm_opportunity_probability_history")) return { rows: [] };
        if (sql.includes("FROM tenant.crm_automation_rules")) return { rows: [] };
        if (sql.includes("INSERT INTO tenant.platform_events")) return { rows: [] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
  };
}

test("restoreOpportunity: requires a non-empty reason", async () => {
  const { client } = restoringClient();
  await assert.rejects(
    () => restoreOpportunity(client, context, opportunity, "   "),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "CRM_OPPORTUNITY_RESTORE_REASON_REQUIRED");
      return true;
    },
  );
});

test("restoreOpportunity: rejects a non-archived opportunity", async () => {
  const { client } = restoringClient({ current: opportunityRow({ status: "open" }) });
  await assert.rejects(
    () => restoreOpportunity(client, context, opportunity, "Client re-engaged"),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "CRM_OPPORTUNITY_NOT_ARCHIVED");
      return true;
    },
  );
});

test("restoreOpportunity: a stale expectedUpdatedAt is rejected", async () => {
  const { client } = restoringClient({
    currentStage: { id: archivedFromStage, pipeline_id: pipeline, probability: "20.00", forecast_category: "pipeline" },
  });
  await assert.rejects(
    () => restoreOpportunity(client, context, opportunity, "Client re-engaged", { expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }),
    (error) => {
      assert.equal(error.code, "CRM_STALE_WRITE");
      return true;
    },
  );
});

test("restoreOpportunity: restores into its original stage when that stage is still active and open", async () => {
  const { client, queries } = restoringClient({
    currentStage: { id: archivedFromStage, pipeline_id: pipeline, probability: "20.00", forecast_category: "pipeline" },
  });
  const result = await restoreOpportunity(client, context, opportunity, "Client re-engaged after a quiet quarter", { expectedUpdatedAt: updatedAt });

  assert.equal(result.status, "open");
  assert.equal(result.stageId, archivedFromStage);
  assert.equal(result.outcomeReasonId, null, "outcome fields must be cleared, not left pointing at the stale close reason");
  assert.equal(result.lostReasonId, null);
  assert.equal(result.actualCloseDate, null);

  const update = queries.find((q) => q.sql.startsWith("UPDATE tenant.crm_opportunities"));
  assert.ok(update, "expected the governed UPDATE");
  assert.ok(update.values.includes(archivedFromStage));

  const historyInsert = queries.find((q) => q.sql.includes("INSERT INTO tenant.crm_opportunity_stage_history"));
  assert.ok(historyInsert, "expected a stage-history row documenting the restore");
  assert.ok(historyInsert.values.some((v) => typeof v === "string" && v.includes("Restored from archive")));

  const probabilityInsert = queries.find((q) => q.sql.includes("INSERT INTO tenant.crm_opportunity_probability_history"));
  assert.ok(probabilityInsert, "expected a probability-history row since probability changed from 0 to 20");
  // 'restored' is a literal in the SQL text (not a bound parameter), same
  // pattern updateOpportunityProbability's own 'manual_override' source uses
  // — deliberately never attacker-influenced input.
  assert.match(probabilityInsert.sql, /'restored'/);
});

test("restoreOpportunity: falls back to the pipeline's default open stage when the original stage is no longer active/open", async () => {
  const fallbackStageId = "99999999-9999-4999-8999-999999999999";
  const { client, queries } = restoringClient({
    currentStage: null, // the archived-from stage was since deactivated (or is now a Won/Lost stage)
    fallbackStage: { id: fallbackStageId, pipeline_id: pipeline, probability: "10.00", forecast_category: "pipeline", sequence: 10 },
  });
  const result = await restoreOpportunity(client, context, opportunity, "Reviving this pursuit");
  assert.equal(result.stageId, fallbackStageId);

  const historyInsert = queries.find((q) => q.sql.includes("INSERT INTO tenant.crm_opportunity_stage_history"));
  assert.ok(historyInsert.values.includes(fallbackStageId));
});

test("restoreOpportunity: fails closed when the pipeline has no active open stage at all", async () => {
  const { client } = restoringClient({ currentStage: null, fallbackStage: null });
  await assert.rejects(
    () => restoreOpportunity(client, context, opportunity, "Reviving this pursuit"),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "CRM_OPPORTUNITY_RESTORE_STAGE_UNAVAILABLE");
      return true;
    },
  );
});

test("restoreOpportunity: 404s when the opportunity is not found or out of scope", async () => {
  const { client } = restoringClient({ current: null });
  await assert.rejects(
    () => restoreOpportunity(client, context, opportunity, "Reviving this pursuit"),
    (error) => {
      assert.equal(error.status, 404);
      return true;
    },
  );
});
