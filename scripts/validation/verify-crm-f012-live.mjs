import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import pg from "pg";

import {
  archiveCrmRecord,
  createCrmRecord,
  moveOpportunityStage,
} from "../../services/api/src/modules/crm/index.js";
import {
  createSalesStage,
  getSalesStage,
  listSalesStages,
  reorderSalesStages,
  setSalesStageActive,
  updateSalesStage,
} from "../../services/api/src/modules/crm/opportunity-and-pipeline-governance/sales-stage-operations.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [
  path.join(root, "apps/web/.env.local"),
  path.join(root, "apps/web/.env"),
  path.join(root, ".env"),
]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}

const connectionString = String(
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "",
).trim();
if (!connectionString)
  throw new Error(
    "MIGRATION_DATABASE_URL or DATABASE_URL is required for F012 live verification. " +
      "The verifier loads apps/web/.env.local, apps/web/.env and .env automatically.",
  );

const client = new pg.Client({
  connectionString,
  application_name: "vercentlabs-f012-live-verifier",
});

const result = {
  historyTablePresent: false,
  terminalConstraintsPresent: false,
  controlledCatalogueCreated: false,
  terminalSemanticsEnforced: false,
  terminalDuplicateBlocked: false,
  openInitialStageSelected: false,
  terminalInitialStageBlocked: false,
  stageDefaultUpdated: false,
  updateReplayMutationFree: false,
  existingOpportunityNotRetroactive: false,
  staleUpdateBlocked: false,
  staleUpdateMutationFree: false,
  usedTypeChangeBlocked: false,
  f010StageDefaultApplied: false,
  openUsageDeactivateBlocked: false,
  safeDeactivateApplied: false,
  lastOpenDeactivateBlocked: false,
  reactivateApplied: false,
  reorderApplied: false,
  reorderReplayMutationFree: false,
  terminalOrderPreserved: false,
  historyWritten: false,
  outboxWritten: false,
  rolledBack: false,
};

let transactionOpen = false;
let organizationId = null;
let pipelineId = null;

await client.connect();
try {
  await client.query("BEGIN");
  transactionOpen = true;

  result.historyTablePresent = Boolean(
    (
      await client.query(
        `SELECT to_regclass('tenant.crm_sales_stage_configuration_history') AS table_name`,
      )
    ).rows[0]?.table_name,
  );
  const constraints = await client.query(
    `SELECT conname FROM pg_constraint
      WHERE conrelid='tenant.crm_pipeline_stages'::regclass
        AND conname IN ('crm_pipeline_stages_won_semantics_f012','crm_pipeline_stages_lost_semantics_f012')`,
  );
  result.terminalConstraintsPresent = constraints.rowCount === 2;

  const base = (
    await client.query(
      `SELECT pipeline.organization_id,pipeline.company_id,organization.base_currency
         FROM tenant.crm_pipelines pipeline
         JOIN public.organizations organization ON organization.id=pipeline.organization_id
        WHERE pipeline.status='active'
        ORDER BY pipeline.is_default DESC,pipeline.created_at,pipeline.id
        LIMIT 1`,
    )
  ).rows[0];
  if (!base) throw new Error("F012 live verification requires at least one active CRM pipeline.");
  organizationId = base.organization_id;

  await client.query("SELECT set_config('app.current_organization_id',$1,true)", [organizationId]);

  const seller = (
    await client.query(
      `SELECT membership.user_id
         FROM public.organization_memberships membership
         JOIN public.users user_account ON user_account.id=membership.user_id AND user_account.status='active'
        WHERE membership.organization_id=$1 AND membership.status='active'
          AND EXISTS (
            SELECT 1 FROM public.user_role_assignments assignment
            JOIN public.roles role ON role.organization_id=assignment.organization_id AND role.id=assignment.role_id AND role.status='active'
            LEFT JOIN public.role_permissions permission ON permission.role_id=role.id AND permission.permission_key='crm.view'
            WHERE assignment.organization_id=membership.organization_id AND assignment.user_id=membership.user_id
              AND assignment.status='active' AND assignment.starts_at<=now()
              AND (assignment.expires_at IS NULL OR assignment.expires_at>now())
              AND (role.slug='organization_owner' OR permission.permission_key IS NOT NULL)
          )
        ORDER BY membership.created_at,membership.user_id LIMIT 1`,
      [organizationId],
    )
  ).rows[0];
  if (!seller) throw new Error("F012 verification organization has no active CRM-eligible member.");

  const context = {
    organizationId,
    userId: seller.user_id,
    activeCompanyId: base.company_id,
    activeBranchId: null,
    allowAllCompanies: true,
    roleSlugs: ["organization_owner"],
    permissions: ["crm.view", "crm.settings.manage", "crm.opportunities.manage", "crm.records.view_all"],
  };

  // F010 invokes automation after a stage move. Keep the production hook in
  // place but isolate this rolled-back verifier from unrelated customer rules.
  const serviceClient = {
    async query(...args) {
      const first = args[0];
      const sql = typeof first === "string" ? first : String(first?.text || "");
      if (sql.includes("FROM tenant.crm_automation_rules") && sql.includes("event_type = $2") && sql.includes("status = 'active'"))
        return { rows: [], rowCount: 0 };
      return client.query(...args);
    },
  };

  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  pipelineId = randomUUID();
  await client.query(
    `INSERT INTO tenant.crm_pipelines
      (id,organization_id,company_id,name,code,description,is_default,status,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,'Rolled-back F012 verifier pipeline',false,'active',$6,$6)`,
    [pipelineId, organizationId, base.company_id, `F012 Verify ${suffix}`, `F012_VERIFY_${suffix}`, seller.user_id],
  );

  const openA = await createSalesStage(client, context, {
    pipelineId,
    name: `Discovery ${suffix}`,
    stageType: "open",
    probability: 20,
    forecastCategory: "pipeline",
    staleAfterDays: 14,
  });
  const openB = await createSalesStage(client, context, {
    pipelineId,
    name: `Proposal ${suffix}`,
    stageType: "open",
    probability: 50,
    forecastCategory: "best_case",
    staleAfterDays: 10,
  });
  const won = await createSalesStage(client, context, {
    pipelineId,
    name: `Won ${suffix}`,
    stageType: "won",
    probability: 12,
    forecastCategory: "pipeline",
    staleAfterDays: 30,
  });
  const lost = await createSalesStage(client, context, {
    pipelineId,
    name: `Lost ${suffix}`,
    stageType: "lost",
    probability: 88,
    forecastCategory: "best_case",
    staleAfterDays: 30,
  });

  const initialCatalogue = (await listSalesStages(client, context, { pipelineId, status: "active" })).rows;
  result.controlledCatalogueCreated = initialCatalogue.length === 4 && initialCatalogue.map((row) => row.stageType).join(",") === "open,open,won,lost";
  result.terminalSemanticsEnforced =
    Number(won.probability) === 100 && won.forecastCategory === "closed" && won.staleAfterDays == null &&
    Number(lost.probability) === 0 && lost.forecastCategory === "closed" && lost.staleAfterDays == null;

  try {
    await createSalesStage(client, context, { pipelineId, name: `Won duplicate ${suffix}`, stageType: "won", probability: 100, forecastCategory: "closed" });
  } catch (error) {
    result.terminalDuplicateBlocked = error?.code === "CRM_SALES_STAGE_TERMINAL_DUPLICATE";
  }

  const opportunity = await createCrmRecord(serviceClient, context, "opportunities", {
    name: `F012 Opportunity ${suffix}`,
    companyId: base.company_id,
    pipelineId,
    amount: 1000,
    currencyCode: String(base.base_currency || "INR").toUpperCase(),
  });
  result.openInitialStageSelected = opportunity.stageId === openA.id && opportunity.status === "open" && Number(opportunity.probability) === 20;

  try {
    await createCrmRecord(serviceClient, context, "opportunities", {
      name: `F012 terminal create ${suffix}`,
      companyId: base.company_id,
      pipelineId,
      stageId: won.id,
      amount: 100,
      currencyCode: String(base.base_currency || "INR").toUpperCase(),
    });
  } catch (error) {
    result.terminalInitialStageBlocked = error?.code === "CRM_OPPORTUNITY_STAGE_INVALID";
  }

  const beforeUpdate = await getSalesStage(client, context, openA.id);
  const updatedA = await updateSalesStage(client, context, openA.id, {
    pipelineId,
    name: beforeUpdate.name,
    stageType: "open",
    probability: 35,
    forecastCategory: "committed",
    staleAfterDays: 12,
    expectedUpdatedAt: new Date(beforeUpdate.updatedAt).toISOString(),
  });
  result.stageDefaultUpdated = Number(updatedA.probability) === 35 && updatedA.forecastCategory === "committed";
  const replayCountsBefore = (
    await client.query(
      `SELECT
         (SELECT count(*)::int FROM tenant.crm_sales_stage_configuration_history WHERE organization_id=$1 AND stage_id=$2) AS history_count,
         (SELECT count(*)::int FROM tenant.platform_events WHERE organization_id=$1 AND entity_type='sales_stage' AND entity_id=$2) AS outbox_count`,
      [organizationId, openA.id],
    )
  ).rows[0];
  const replayedUpdate = await updateSalesStage(client, context, openA.id, {
    pipelineId,
    name: updatedA.name,
    stageType: "open",
    probability: 35,
    forecastCategory: "committed",
    staleAfterDays: 12,
    expectedUpdatedAt: new Date(beforeUpdate.updatedAt).toISOString(),
  });
  const replayCountsAfter = (
    await client.query(
      `SELECT
         (SELECT count(*)::int FROM tenant.crm_sales_stage_configuration_history WHERE organization_id=$1 AND stage_id=$2) AS history_count,
         (SELECT count(*)::int FROM tenant.platform_events WHERE organization_id=$1 AND entity_type='sales_stage' AND entity_id=$2) AS outbox_count`,
      [organizationId, openA.id],
    )
  ).rows[0];
  result.updateReplayMutationFree =
    replayedUpdate.replayed === true &&
    Number(replayCountsAfter.history_count) === Number(replayCountsBefore.history_count) &&
    Number(replayCountsAfter.outbox_count) === Number(replayCountsBefore.outbox_count);
  const opportunityAfterDefault = (
    await client.query("SELECT probability,expected_revenue FROM tenant.crm_opportunities WHERE organization_id=$1 AND id=$2", [organizationId, opportunity.id])
  ).rows[0];
  result.existingOpportunityNotRetroactive = Number(opportunityAfterDefault.probability) === 20 && Number(opportunityAfterDefault.expected_revenue) === 200;

  const beforeStale = await getSalesStage(client, context, openA.id);
  try {
    await updateSalesStage(client, context, openA.id, { probability: 40, expectedUpdatedAt: "2000-01-01T00:00:00.000Z" });
  } catch (error) {
    result.staleUpdateBlocked = error?.code === "CRM_SALES_STAGE_STALE_WRITE";
  }
  const afterStale = await getSalesStage(client, context, openA.id);
  result.staleUpdateMutationFree = Number(afterStale.probability) === Number(beforeStale.probability) && new Date(afterStale.updatedAt).toISOString() === new Date(beforeStale.updatedAt).toISOString();

  try {
    await updateSalesStage(client, context, openA.id, { stageType: "won", expectedUpdatedAt: new Date(afterStale.updatedAt).toISOString() });
  } catch (error) {
    result.usedTypeChangeBlocked = error?.code === "CRM_SALES_STAGE_TYPE_IN_USE";
  }

  try {
    await setSalesStageActive(client, context, openA.id, false, new Date(afterStale.updatedAt).toISOString());
  } catch (error) {
    result.openUsageDeactivateBlocked = error?.code === "CRM_SALES_STAGE_OPEN_OPPORTUNITIES";
  }

  const currentOpportunity = (
    await client.query("SELECT stage_id,updated_at FROM tenant.crm_opportunities WHERE organization_id=$1 AND id=$2", [organizationId, opportunity.id])
  ).rows[0];
  const moved = await moveOpportunityStage(serviceClient, context, opportunity.id, openB.id, "F012 integration verification", {
    expectedUpdatedAt: new Date(currentOpportunity.updated_at).toISOString(),
    expectedStageId: currentOpportunity.stage_id,
  });
  result.f010StageDefaultApplied = moved.stageId === openB.id && Number(moved.probability) === 50 && Number(moved.expectedRevenue) === 500;

  const openAFresh = await getSalesStage(client, context, openA.id);
  const deactivatedA = await setSalesStageActive(client, context, openA.id, false, new Date(openAFresh.updatedAt).toISOString());
  result.safeDeactivateApplied = deactivatedA.status === "inactive";

  await archiveCrmRecord(serviceClient, context, "opportunities", opportunity.id);
  const openBFresh = await getSalesStage(client, context, openB.id);
  try {
    await setSalesStageActive(client, context, openB.id, false, new Date(openBFresh.updatedAt).toISOString());
  } catch (error) {
    result.lastOpenDeactivateBlocked = error?.code === "CRM_SALES_STAGE_OPEN_REQUIRED";
  }

  const openAInactive = await getSalesStage(client, context, openA.id);
  const reactivatedA = await setSalesStageActive(client, context, openA.id, true, new Date(openAInactive.updatedAt).toISOString());
  result.reactivateApplied = reactivatedA.status === "active";

  const beforeReorder = (await listSalesStages(client, context, { pipelineId, status: "active" })).rows;
  const openRows = beforeReorder.filter((row) => row.stageType === "open");
  const terminalRows = beforeReorder.filter((row) => row.stageType !== "open");
  const desired = [...openRows].reverse().concat(terminalRows);
  const reordered = await reorderSalesStages(client, context, pipelineId, desired.map((row) => ({ id: row.id, expectedUpdatedAt: new Date(row.updatedAt).toISOString() })));
  const activeAfterReorder = reordered.rows.filter((row) => row.status === "active").sort((a, b) => Number(a.sequence) - Number(b.sequence));
  result.reorderApplied = reordered.changed === true && activeAfterReorder[0]?.id === openRows.at(-1)?.id;
  result.terminalOrderPreserved = activeAfterReorder.slice(-2).every((row) => row.stageType !== "open") && activeAfterReorder.slice(0, -2).every((row) => row.stageType === "open");
  const reorderCountsBefore = (
    await client.query(
      `SELECT
         (SELECT count(*)::int FROM tenant.crm_sales_stage_configuration_history WHERE organization_id=$1 AND pipeline_id=$2) AS history_count,
         (SELECT count(*)::int FROM tenant.platform_events WHERE organization_id=$1 AND entity_type='sales_pipeline' AND entity_id=$2) AS outbox_count`,
      [organizationId, pipelineId],
    )
  ).rows[0];
  const replayedOrder = await reorderSalesStages(
    client,
    context,
    pipelineId,
    desired.map((row) => ({ id: row.id, expectedUpdatedAt: new Date(row.updatedAt).toISOString() })),
  );
  const reorderCountsAfter = (
    await client.query(
      `SELECT
         (SELECT count(*)::int FROM tenant.crm_sales_stage_configuration_history WHERE organization_id=$1 AND pipeline_id=$2) AS history_count,
         (SELECT count(*)::int FROM tenant.platform_events WHERE organization_id=$1 AND entity_type='sales_pipeline' AND entity_id=$2) AS outbox_count`,
      [organizationId, pipelineId],
    )
  ).rows[0];
  result.reorderReplayMutationFree =
    replayedOrder.changed === false &&
    Number(reorderCountsAfter.history_count) === Number(reorderCountsBefore.history_count) &&
    Number(reorderCountsAfter.outbox_count) === Number(reorderCountsBefore.outbox_count);

  const historyCount = Number((await client.query("SELECT count(*)::int AS count FROM tenant.crm_sales_stage_configuration_history WHERE organization_id=$1 AND pipeline_id=$2", [organizationId, pipelineId])).rows[0]?.count || 0);
  const outboxCount = Number((await client.query("SELECT count(*)::int AS count FROM tenant.platform_events WHERE organization_id=$1 AND ((entity_type='sales_stage' AND entity_id IN ($2,$3,$4,$5)) OR (entity_type='sales_pipeline' AND entity_id=$6))", [organizationId, openA.id, openB.id, won.id, lost.id, pipelineId])).rows[0]?.count || 0);
  result.historyWritten = historyCount >= 8;
  result.outboxWritten = outboxCount >= 8;

  await client.query("ROLLBACK");
  transactionOpen = false;
  await client.query("SELECT set_config('app.current_organization_id',$1,false)", [organizationId]);
  const afterRollback = await client.query("SELECT count(*)::int AS count FROM tenant.crm_pipelines WHERE organization_id=$1 AND id=$2", [organizationId, pipelineId]);
  result.rolledBack = Number(afterRollback.rows[0]?.count || 0) === 0;

  if (Object.values(result).some((value) => value !== true))
    throw new Error(`F012 live verification failed: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result));
} catch (error) {
  if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
