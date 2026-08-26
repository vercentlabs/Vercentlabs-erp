import { config } from "dotenv";
import pg from "pg";

import {
  createCrmRecord,
  moveOpportunityStage,
} from "../../services/api/src/modules/crm/index.js";

config({ path: "apps/web/.env.local" });
const connectionString =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString)
  throw new Error(
    "Set MIGRATION_DATABASE_URL or DATABASE_URL for F010 live verification.",
  );

const client = new pg.Client({ connectionString });
await client.connect();
await client.query("BEGIN");
try {
  const fixture = await client.query(
    `SELECT p.organization_id,p.company_id,p.id AS pipeline_id,o.base_currency
       FROM tenant.crm_pipelines p
       JOIN public.organizations o ON o.id=p.organization_id
      WHERE p.status='active'
      ORDER BY p.is_default DESC,p.created_at
      LIMIT 1`,
  );
  const base = fixture.rows[0];
  if (!base)
    throw new Error(
      "No active CRM pipeline exists for rolled-back F010 verification.",
    );
  await client.query(
    "SELECT set_config('app.current_organization_id',$1,true)",
    [base.organization_id],
  );

  const seller = await client.query(
    `SELECT membership.user_id
       FROM public.organization_memberships membership
       JOIN public.users user_account
         ON user_account.id=membership.user_id AND user_account.status='active'
      WHERE membership.organization_id=$1 AND membership.status='active'
      ORDER BY membership.created_at
      LIMIT 1`,
    [base.organization_id],
  );
  if (!seller.rows[0])
    throw new Error("Verification organization has no active member.");

  const context = {
    organizationId: base.organization_id,
    userId: seller.rows[0].user_id,
    activeCompanyId: base.company_id,
    activeBranchId: null,
    allowAllCompanies: true,
    roleSlugs: ["organization_owner"],
    permissions: ["crm.view", "crm.opportunities.manage", "crm.records.view_all"],
  };

  // The verifier must test F010 itself, not whichever customer-configured CRM
  // automation rules happen to exist in the selected local organization. Pass
  // every query through to real PostgreSQL except the automation-rule lookup.
  // The production runCrmAutomation hook is still invoked; it simply receives
  // an empty rule set for this rolled-back synthetic record.
  const verificationClient = {
    async query(...args) {
      const first = args[0];
      const sql = typeof first === "string" ? first : String(first?.text || "");
      if (
        sql.includes("FROM tenant.crm_automation_rules") &&
        sql.includes("event_type = $2") &&
        sql.includes("status = 'active'")
      ) {
        return { rows: [], rowCount: 0 };
      }
      return client.query(...args);
    },
  };

  async function readOpportunityState(opportunityId) {
    const result = await client.query(
      `SELECT stage_id,status,updated_at,outcome_reason_id
         FROM tenant.crm_opportunities
        WHERE organization_id=$1 AND id=$2`,
      [base.organization_id, opportunityId],
    );
    if (!result.rows[0])
      throw new Error("F010 verifier opportunity disappeared unexpectedly.");
    return result.rows[0];
  }

  const sequence = await client.query(
    `SELECT COALESCE(max(sequence),0)::int AS max_sequence
       FROM tenant.crm_pipeline_stages
      WHERE organization_id=$1 AND pipeline_id=$2`,
    [base.organization_id, base.pipeline_id],
  );
  const baseSequence = Number(sequence.rows[0]?.max_sequence || 0) + 100;
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const firstStage = await client.query(
    `INSERT INTO tenant.crm_pipeline_stages
      (organization_id,pipeline_id,name,code,sequence,probability,forecast_category,status,created_by,updated_by)
     VALUES ($1,$2,'F010 Verify Open A',$3,$4,20,'pipeline','active',$5,$5)
     RETURNING id,probability,forecast_category`,
    [
      base.organization_id,
      base.pipeline_id,
      `F010_VERIFY_A_${suffix}`,
      baseSequence,
      context.userId,
    ],
  );
  const secondStage = await client.query(
    `INSERT INTO tenant.crm_pipeline_stages
      (organization_id,pipeline_id,name,code,sequence,probability,forecast_category,status,created_by,updated_by)
     VALUES ($1,$2,'F010 Verify Open B',$3,$4,55,'best_case','active',$5,$5)
     RETURNING id,probability,forecast_category`,
    [
      base.organization_id,
      base.pipeline_id,
      `F010_VERIFY_B_${suffix}`,
      baseSequence + 1,
      context.userId,
    ],
  );
  const wonStage = await client.query(
    `INSERT INTO tenant.crm_pipeline_stages
      (organization_id,pipeline_id,name,code,sequence,probability,forecast_category,is_won,status,created_by,updated_by)
     VALUES ($1,$2,'F010 Verify Won',$3,$4,100,'closed',true,'active',$5,$5)
     RETURNING id`,
    [
      base.organization_id,
      base.pipeline_id,
      `F010_VERIFY_WON_${suffix}`,
      baseSequence + 2,
      context.userId,
    ],
  );
  const wonReason = await client.query(
    `INSERT INTO tenant.crm_lost_reasons
      (organization_id,name,code,category,outcome_type,status,created_by,updated_by)
     VALUES ($1,'F010 verification win',$2,'other','won','active',$3,$3)
     RETURNING id`,
    [base.organization_id, `F010_VERIFY_REASON_${suffix}`, context.userId],
  );

  const otherPipeline = await client.query(
    `INSERT INTO tenant.crm_pipelines
      (organization_id,company_id,name,code,status,created_by,updated_by)
     VALUES ($1,$2,'F010 Verify Other',$3,'active',$4,$4)
     RETURNING id`,
    [
      base.organization_id,
      base.company_id,
      `F010_VERIFY_OTHER_${suffix}`,
      context.userId,
    ],
  );
  const otherStage = await client.query(
    `INSERT INTO tenant.crm_pipeline_stages
      (organization_id,pipeline_id,name,code,sequence,probability,forecast_category,status,created_by,updated_by)
     VALUES ($1,$2,'F010 Verify Other Stage',$3,1,10,'pipeline','active',$4,$4)
     RETURNING id`,
    [
      base.organization_id,
      otherPipeline.rows[0].id,
      `F010_VERIFY_OTHER_STAGE_${suffix}`,
      context.userId,
    ],
  );

  const created = await createCrmRecord(
    verificationClient,
    context,
    "opportunities",
    {
      name: "F010 rolled-back pipeline verification",
      companyId: base.company_id,
      pipelineId: base.pipeline_id,
      stageId: firstStage.rows[0].id,
      amount: 1234.56,
      currencyCode: String(base.base_currency || "INR"),
      nextStep: "Verify governed pipeline movement",
    },
  );

  const createdState = await readOpportunityState(created.id);
  if (
    createdState.stage_id !== firstStage.rows[0].id ||
    createdState.status !== "open"
  ) {
    throw new Error(
      `F010 verifier create-state mismatch: ${JSON.stringify(createdState)}`,
    );
  }

  let crossPipelineBlocked = false;
  try {
    await moveOpportunityStage(
      verificationClient,
      context,
      created.id,
      otherStage.rows[0].id,
      "must fail",
      {
        expectedUpdatedAt: new Date(createdState.updated_at).toISOString(),
        expectedStageId: createdState.stage_id,
      },
    );
  } catch (error) {
    crossPipelineBlocked = /not part of this opportunity pipeline/i.test(
      String(error?.message || error),
    );
  }

  const afterCrossPipeline = await readOpportunityState(created.id);
  if (
    afterCrossPipeline.stage_id !== createdState.stage_id ||
    afterCrossPipeline.status !== "open"
  ) {
    throw new Error(
      `F010 cross-pipeline rejection mutated the opportunity: ${JSON.stringify(afterCrossPipeline)}`,
    );
  }

  const historyBefore = await client.query(
    `SELECT count(*)::int AS count
       FROM tenant.crm_opportunity_stage_history
      WHERE organization_id=$1 AND opportunity_id=$2`,
    [base.organization_id, created.id],
  );
  const outboxBefore = await client.query(
    `SELECT count(*)::int AS count
       FROM tenant.crm_outbox_events
      WHERE organization_id=$1 AND entity_type='opportunity' AND entity_id=$2
        AND event_type='crm.opportunity.stage_changed'`,
    [base.organization_id, created.id],
  );

  const moved = await moveOpportunityStage(
    verificationClient,
    context,
    created.id,
    secondStage.rows[0].id,
    "F010 open-stage verification",
    {
      expectedUpdatedAt: new Date(afterCrossPipeline.updated_at).toISOString(),
      expectedStageId: afterCrossPipeline.stage_id,
    },
  );
  const afterMove = await readOpportunityState(created.id);
  if (
    afterMove.stage_id !== secondStage.rows[0].id ||
    afterMove.status !== "open"
  ) {
    throw new Error(
      `F010 authoritative post-move state mismatch: ${JSON.stringify(afterMove)}`,
    );
  }

  const historyAfterMove = await client.query(
    `SELECT count(*)::int AS count
       FROM tenant.crm_opportunity_stage_history
      WHERE organization_id=$1 AND opportunity_id=$2`,
    [base.organization_id, created.id],
  );
  const outboxAfterMove = await client.query(
    `SELECT count(*)::int AS count
       FROM tenant.crm_outbox_events
      WHERE organization_id=$1 AND entity_type='opportunity' AND entity_id=$2
        AND event_type='crm.opportunity.stage_changed'`,
    [base.organization_id, created.id],
  );

  const replay = await moveOpportunityStage(
    verificationClient,
    context,
    created.id,
    afterMove.stage_id,
    "F010 same-stage replay",
    {
      expectedUpdatedAt: new Date(afterMove.updated_at).toISOString(),
      expectedStageId: afterMove.stage_id,
    },
  );
  const afterReplay = await readOpportunityState(created.id);
  const historyAfterReplay = await client.query(
    `SELECT count(*)::int AS count
       FROM tenant.crm_opportunity_stage_history
      WHERE organization_id=$1 AND opportunity_id=$2`,
    [base.organization_id, created.id],
  );
  const outboxAfterReplay = await client.query(
    `SELECT count(*)::int AS count
       FROM tenant.crm_outbox_events
      WHERE organization_id=$1 AND entity_type='opportunity' AND entity_id=$2
        AND event_type='crm.opportunity.stage_changed'`,
    [base.organization_id, created.id],
  );

  // A stale token does not require mutating the live row. Use a timestamp that
  // is certainly older than the authoritative DB version, while pairing it with
  // the correct current stage. This exercises CRM_STALE_WRITE deterministically
  // without introducing verifier-only state changes or transaction-time quirks.
  const authoritativeUpdatedAt = new Date(afterReplay.updated_at);
  const staleUpdatedAt = new Date(
    authoritativeUpdatedAt.getTime() - 60_000,
  ).toISOString();
  let staleBlocked = false;
  try {
    await moveOpportunityStage(
      verificationClient,
      context,
      created.id,
      wonStage.rows[0].id,
      "stale move",
      {
        expectedUpdatedAt: staleUpdatedAt,
        expectedStageId: afterReplay.stage_id,
        outcomeReasonId: wonReason.rows[0].id,
      },
    );
  } catch (error) {
    staleBlocked = error?.code === "CRM_STALE_WRITE";
  }

  const freshBeforeWon = await readOpportunityState(created.id);
  if (
    freshBeforeWon.stage_id !== secondStage.rows[0].id ||
    freshBeforeWon.status !== "open"
  ) {
    throw new Error(
      `F010 stale-write rejection mutated the opportunity: ${JSON.stringify(freshBeforeWon)}`,
    );
  }

  const won = await moveOpportunityStage(
    verificationClient,
    context,
    created.id,
    wonStage.rows[0].id,
    "F010 won verification",
    {
      expectedUpdatedAt: new Date(freshBeforeWon.updated_at).toISOString(),
      expectedStageId: freshBeforeWon.stage_id,
      outcomeReasonId: wonReason.rows[0].id,
      outcomeNotes: "F010 won verification",
    },
  );
  const afterWon = await readOpportunityState(created.id);

  let reopenBlocked = false;
  try {
    await moveOpportunityStage(
      verificationClient,
      context,
      created.id,
      secondStage.rows[0].id,
      "must not reopen",
      {
        expectedUpdatedAt: new Date(afterWon.updated_at).toISOString(),
        expectedStageId: afterWon.stage_id,
      },
    );
  } catch (error) {
    reopenBlocked = error?.code === "CRM_OPPORTUNITY_PIPELINE_CLOSED";
  }
  const afterReopenAttempt = await readOpportunityState(created.id);

  const terminalHistory = await client.query(
    `SELECT count(*)::int AS count
       FROM tenant.crm_opportunity_stage_history
      WHERE organization_id=$1 AND opportunity_id=$2
        AND from_stage_id=$3 AND to_stage_id=$4`,
    [base.organization_id, created.id, secondStage.rows[0].id, wonStage.rows[0].id],
  );

  const result = {
    createdOpen: createdState.status === "open",
    crossPipelineBlocked,
    crossPipelineMutationFree:
      afterCrossPipeline.stage_id === createdState.stage_id &&
      afterCrossPipeline.status === createdState.status,
    movedToSelectedStage:
      moved.stageId === secondStage.rows[0].id &&
      afterMove.stage_id === secondStage.rows[0].id,
    stageProbabilityApplied:
      Number(moved.probability) === Number(secondStage.rows[0].probability),
    historyIncremented:
      Number(historyAfterMove.rows[0].count) ===
      Number(historyBefore.rows[0].count) + 1,
    outboxIncremented:
      Number(outboxAfterMove.rows[0].count) > Number(outboxBefore.rows[0].count),
    sameStageReplayNoHistory:
      Number(historyAfterReplay.rows[0].count) ===
      Number(historyAfterMove.rows[0].count),
    sameStageReplayNoOutbox:
      Number(outboxAfterReplay.rows[0].count) ===
      Number(outboxAfterMove.rows[0].count),
    replayReturnedCurrent:
      replay.stageId === afterMove.stage_id &&
      afterReplay.stage_id === afterMove.stage_id,
    staleBlocked,
    staleMutationFree:
      freshBeforeWon.stage_id === afterReplay.stage_id &&
      freshBeforeWon.status === afterReplay.status,
    terminalClosedWon:
      won.status === "won" &&
      afterWon.status === "won" &&
      afterWon.stage_id === wonStage.rows[0].id &&
      String(afterWon.outcome_reason_id) === String(wonReason.rows[0].id),
    reopenBlocked,
    reopenMutationFree:
      afterReopenAttempt.status === "won" &&
      afterReopenAttempt.stage_id === wonStage.rows[0].id &&
      String(afterReopenAttempt.outcome_reason_id) === String(wonReason.rows[0].id),
    latestHistoryIsTerminal: Number(terminalHistory.rows[0]?.count || 0) === 1,
    rolledBack: true,
  };
  if (Object.values(result).some((value) => value !== true))
    throw new Error(`F010 live verification failed: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result));
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}
