import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import pg from "pg";

import {
  moveOpportunityStage,
  updateOpportunityProbability,
} from "../../services/api/src/modules/crm/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [
  path.join(root, "apps/web/.env.local"),
  path.join(root, "apps/web/.env"),
  path.join(root, ".env"),
]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}

// Live verification creates and rolls back synthetic tenant fixtures. The
// migration connection is deliberately preferred: the migration runner that
// immediately precedes this verifier uses the same URL, and it can discover a
// tenant before app.current_organization_id has been established. The runtime
// URL remains a fallback for environments where it is sufficient.
const connectionString = String(
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "",
).trim();
if (!connectionString) {
  throw new Error(
    "MIGRATION_DATABASE_URL or DATABASE_URL is required for F011 live verification. " +
      "The verifier loads apps/web/.env.local, apps/web/.env and .env automatically.",
  );
}

const client = new pg.Client({
  connectionString,
  application_name: "vercentlabs-f011-live-verifier",
});

const result = {
  generatedColumnPresent: false,
  createdExpectedRevenue: false,
  probabilityUpdated: false,
  expectedRevenueRecomputed: false,
  historyIncremented: false,
  outboxIncremented: false,
  replayMutationFree: false,
  staleBlocked: false,
  staleMutationFree: false,
  stageResetApplied: false,
  stageResetRevenueRecomputed: false,
  amountEditRecomputed: false,
  closedBlocked: false,
  rolledBack: false,
};

const expectedRevenue = (amount, probability) =>
  Math.round(Number(amount) * Number(probability)) / 100;
const moneyEqual = (actual, expected) =>
  Math.abs(Number(actual) - Number(expected)) < 0.000001;

let transactionOpen = false;
let organizationId = null;
let opportunityId = null;

await client.connect();
try {
  await client.query("BEGIN");
  transactionOpen = true;

  const generated = await client.query(
    `SELECT is_generated,generation_expression
       FROM information_schema.columns
      WHERE table_schema='tenant'
        AND table_name='crm_opportunities'
        AND column_name='expected_revenue'`,
  );
  result.generatedColumnPresent =
    generated.rows[0]?.is_generated === "ALWAYS" &&
    /amount/i.test(String(generated.rows[0]?.generation_expression || "")) &&
    /probability/i.test(String(generated.rows[0]?.generation_expression || ""));

  // Only an active pipeline is required from local configuration. The verifier
  // creates its own two open stages below, so customer-configured stage count,
  // labels and probabilities cannot make this test flaky.
  const base = (
    await client.query(
      `SELECT p.organization_id,p.company_id,p.id AS pipeline_id,o.base_currency
         FROM tenant.crm_pipelines p
         JOIN public.organizations o ON o.id=p.organization_id
        WHERE p.status='active'
        ORDER BY p.is_default DESC,p.created_at,p.id
        LIMIT 1`,
    )
  ).rows[0];
  if (!base) {
    throw new Error(
      "F011 live verification requires at least one active CRM pipeline.",
    );
  }
  organizationId = base.organization_id;

  await client.query(
    "SELECT set_config('app.current_organization_id',$1,true)",
    [organizationId],
  );

  const seller = (
    await client.query(
      `SELECT membership.user_id
         FROM public.organization_memberships membership
         JOIN public.users user_account
           ON user_account.id=membership.user_id
          AND user_account.status='active'
        WHERE membership.organization_id=$1
          AND membership.status='active'
        ORDER BY membership.created_at,membership.user_id
        LIMIT 1`,
      [organizationId],
    )
  ).rows[0];
  if (!seller) {
    throw new Error(
      "F011 verification organization has no active user membership.",
    );
  }

  const context = {
    organizationId,
    userId: seller.user_id,
    activeCompanyId: base.company_id,
    activeBranchId: null,
    allowAllCompanies: true,
    roleSlugs: ["organization_owner"],
    permissions: [
      "crm.view",
      "crm.opportunities.manage",
      "crm.records.view_all",
    ],
  };

  // Do not let unrelated customer-configured CRM automation mutate the
  // verifier Opportunity. Every other statement still hits real PostgreSQL.
  const serviceClient = {
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

  const sequence = await client.query(
    `SELECT COALESCE(max(sequence),0)::int AS max_sequence
       FROM tenant.crm_pipeline_stages
      WHERE organization_id=$1 AND pipeline_id=$2`,
    [organizationId, base.pipeline_id],
  );
  const sequenceBase = Number(sequence.rows[0]?.max_sequence || 0) + 100;
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;

  const stageA = (
    await client.query(
      `INSERT INTO tenant.crm_pipeline_stages
        (organization_id,pipeline_id,name,code,sequence,probability,forecast_category,status,created_by,updated_by)
       VALUES ($1,$2,'F011 Verify Open A',$3,$4,20,'pipeline','active',$5,$5)
       RETURNING id,probability,forecast_category`,
      [
        organizationId,
        base.pipeline_id,
        `F011_VERIFY_A_${suffix}`,
        sequenceBase,
        seller.user_id,
      ],
    )
  ).rows[0];
  const stageB = (
    await client.query(
      `INSERT INTO tenant.crm_pipeline_stages
        (organization_id,pipeline_id,name,code,sequence,probability,forecast_category,status,created_by,updated_by)
       VALUES ($1,$2,'F011 Verify Open B',$3,$4,55,'best_case','active',$5,$5)
       RETURNING id,probability,forecast_category`,
      [
        organizationId,
        base.pipeline_id,
        `F011_VERIFY_B_${suffix}`,
        sequenceBase + 1,
        seller.user_id,
      ],
    )
  ).rows[0];

  opportunityId = randomUUID();
  const inserted = (
    await client.query(
      `INSERT INTO tenant.crm_opportunities
        (id,organization_id,company_id,code,pipeline_id,stage_id,owner_user_id,
         name,amount,currency_code,probability,status,forecast_category,created_by,updated_by)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,'F011 live verifier',1000,$8,$9,'open',$10,$7,$7)
       RETURNING *`,
      [
        opportunityId,
        organizationId,
        base.company_id,
        `F011-LIVE-${suffix}`,
        base.pipeline_id,
        stageA.id,
        seller.user_id,
        String(base.base_currency || "INR").toUpperCase(),
        stageA.probability,
        stageA.forecast_category,
      ],
    )
  ).rows[0];

  result.createdExpectedRevenue = moneyEqual(
    inserted.expected_revenue,
    expectedRevenue(1000, stageA.probability),
  );

  const countProbabilityHistory = async () =>
    Number(
      (
        await client.query(
          `SELECT count(*)::int AS count
             FROM tenant.crm_opportunity_probability_history
            WHERE organization_id=$1 AND opportunity_id=$2`,
          [organizationId, opportunityId],
        )
      ).rows[0]?.count || 0,
    );
  const countProbabilityOutbox = async () =>
    Number(
      (
        await client.query(
          `SELECT count(*)::int AS count
             FROM tenant.crm_outbox_events
            WHERE organization_id=$1
              AND entity_type='opportunity'
              AND entity_id=$2
              AND event_type='crm.opportunity.probability_changed'`,
          [organizationId, opportunityId],
        )
      ).rows[0]?.count || 0,
    );
  const readState = async () => {
    const state = (
      await client.query(
        `SELECT stage_id,status,amount,probability,expected_revenue,updated_at
           FROM tenant.crm_opportunities
          WHERE organization_id=$1 AND id=$2`,
        [organizationId, opportunityId],
      )
    ).rows[0];
    if (!state) throw new Error("F011 verifier Opportunity disappeared.");
    return state;
  };

  const historyBefore = await countProbabilityHistory();
  const outboxBefore = await countProbabilityOutbox();
  const changed = await updateOpportunityProbability(
    serviceClient,
    context,
    opportunityId,
    72.5,
    "F011 live probability verification",
    {
      expectedUpdatedAt: new Date(inserted.updated_at).toISOString(),
      expectedProbability: Number(inserted.probability),
    },
  );

  result.probabilityUpdated = Number(changed.probability) === 72.5;
  result.expectedRevenueRecomputed = moneyEqual(changed.expectedRevenue, 725);
  result.historyIncremented =
    (await countProbabilityHistory()) === historyBefore + 1;
  result.outboxIncremented =
    (await countProbabilityOutbox()) === outboxBefore + 1;

  const historyAfterChange = await countProbabilityHistory();
  const outboxAfterChange = await countProbabilityOutbox();
  const replay = await updateOpportunityProbability(
    serviceClient,
    context,
    opportunityId,
    72.5,
    null,
    {
      // Deliberately reuse the pre-change token. Desired-state replay must be
      // idempotent when a previous response was lost.
      expectedUpdatedAt: new Date(inserted.updated_at).toISOString(),
      expectedProbability: Number(inserted.probability),
    },
  );
  result.replayMutationFree =
    replay.replayed === true &&
    (await countProbabilityHistory()) === historyAfterChange &&
    (await countProbabilityOutbox()) === outboxAfterChange;

  const beforeStale = await readState();
  try {
    await updateOpportunityProbability(
      serviceClient,
      context,
      opportunityId,
      60,
      null,
      {
        expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
        expectedProbability: 72.5,
      },
    );
  } catch (error) {
    result.staleBlocked = error?.code === "CRM_STALE_WRITE";
  }
  const afterStale = await readState();
  result.staleMutationFree =
    Number(afterStale.probability) === Number(beforeStale.probability) &&
    moneyEqual(afterStale.expected_revenue, beforeStale.expected_revenue) &&
    new Date(afterStale.updated_at).toISOString() ===
      new Date(beforeStale.updated_at).toISOString();

  const moved = await moveOpportunityStage(
    serviceClient,
    context,
    opportunityId,
    stageB.id,
    "F011 stage integration verification",
    {
      expectedUpdatedAt: new Date(afterStale.updated_at).toISOString(),
      expectedStageId: stageA.id,
    },
  );
  result.stageResetApplied = Number(moved.probability) === 55;
  result.stageResetRevenueRecomputed = moneyEqual(moved.expectedRevenue, 550);

  const amountEdited = (
    await client.query(
      `UPDATE tenant.crm_opportunities
          SET amount=1234.56,updated_by=$3,updated_at=now()
        WHERE organization_id=$1 AND id=$2
        RETURNING probability,expected_revenue`,
      [organizationId, opportunityId, seller.user_id],
    )
  ).rows[0];
  result.amountEditRecomputed = moneyEqual(
    amountEdited.expected_revenue,
    expectedRevenue(1234.56, amountEdited.probability),
  );

  // Archive is sufficient to prove the governed probability action refuses a
  // non-open Opportunity without creating an intentionally incomplete Won/Lost
  // record that would bypass F010's terminal-outcome workflow.
  await client.query(
    `UPDATE tenant.crm_opportunities
        SET status='archived',updated_by=$3,updated_at=now()
      WHERE organization_id=$1 AND id=$2`,
    [organizationId, opportunityId, seller.user_id],
  );
  try {
    await updateOpportunityProbability(
      serviceClient,
      context,
      opportunityId,
      50,
    );
  } catch (error) {
    result.closedBlocked =
      error?.code === "CRM_OPPORTUNITY_PROBABILITY_CLOSED";
  }

  await client.query("ROLLBACK");
  transactionOpen = false;

  // set_config(..., true) was transaction-local, so restore the tenant context
  // before verifying that the synthetic Opportunity really disappeared.
  await client.query(
    "SELECT set_config('app.current_organization_id',$1,false)",
    [organizationId],
  );
  const afterRollback = await client.query(
    `SELECT count(*)::int AS count
       FROM tenant.crm_opportunities
      WHERE organization_id=$1 AND id=$2`,
    [organizationId, opportunityId],
  );
  result.rolledBack = Number(afterRollback.rows[0]?.count || 0) === 0;

  if (Object.values(result).some((value) => value !== true)) {
    throw new Error(`F011 live verification failed: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));
} catch (error) {
  if (transactionOpen) {
    await client.query("ROLLBACK").catch(() => undefined);
    transactionOpen = false;
  }
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
