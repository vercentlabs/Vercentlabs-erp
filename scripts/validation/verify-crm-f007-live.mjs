import { config } from "dotenv";
import pg from "pg";

import {
  createLeadStage,
  setLeadStageActive,
  transitionLeadStage,
  updateLeadStage,
} from "../../services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-lifecycle.js";

config({ path: "apps/web/.env.local" });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await client.query("BEGIN");
try {
  const organizations = await client.query("SELECT id FROM public.organizations ORDER BY created_at");
  let lead = null;
  for (const organization of organizations.rows) {
    await client.query("SELECT set_config('app.current_organization_id',$1,true)", [organization.id]);
    const candidate = await client.query(
      `SELECT organization_id,id,updated_at
         FROM tenant.crm_leads
        WHERE organization_id=$1 AND record_status='active' AND status='new'
        ORDER BY created_at LIMIT 1`,
      [organization.id],
    );
    if (candidate.rows[0]) {
      lead = candidate.rows[0];
      break;
    }
  }
  if (!lead) throw new Error("No active New Lead is available for rolled-back F007 verification.");
  const membership = await client.query(
    `SELECT user_id FROM public.organization_memberships
      WHERE organization_id=$1 AND status='active' ORDER BY created_at LIMIT 1`,
    [lead.organization_id],
  );
  if (!membership.rows[0]) throw new Error("The verification organization has no active member.");
  const context = {
    organizationId: lead.organization_id,
    userId: membership.rows[0].user_id,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    roleSlugs: ["organization_owner"],
    permissions: ["crm.records.view_all"],
  };
  const configured = await createLeadStage(client, context, {
    name: `F007 verification ${Date.now()}`,
    description: "Rolled-back lifecycle configuration verification",
    sortOrder: 90,
  });
  const renamed = await updateLeadStage(client, context, configured.id, {
    name: `${configured.name} renamed`,
    sortOrder: 95,
  });
  const inactive = await setLeadStageActive(client, context, configured.id, false);
  const reactivated = await setLeadStageActive(client, context, configured.id, true);
  const before = await client.query(
    `SELECT
       (SELECT count(*)::int FROM tenant.crm_lead_stage_events WHERE organization_id=$1 AND lead_id=$2) history,
       (SELECT count(*)::int FROM tenant.platform_events WHERE organization_id=$1 AND entity_id=$2 AND event_type='crm.lead.stage_changed') outbox`,
    [lead.organization_id, lead.id],
  );
  const result = await transitionLeadStage(
    client,
    context,
    lead.id,
    {
      stageCode: "contacted",
      expectedUpdatedAt: lead.updated_at,
      source: "api",
      note: "F007 rolled-back verification",
    },
  );
  const after = await client.query(
    `SELECT
       (SELECT count(*)::int FROM tenant.crm_lead_stage_events WHERE organization_id=$1 AND lead_id=$2) history,
       (SELECT count(*)::int FROM tenant.platform_events WHERE organization_id=$1 AND entity_id=$2 AND event_type='crm.lead.stage_changed') outbox`,
    [lead.organization_id, lead.id],
  );
  let guardBlocked = false;
  await client.query("SAVEPOINT f007_direct_write");
  try {
    await client.query(
      "UPDATE tenant.crm_leads SET status='working' WHERE organization_id=$1 AND id=$2",
      [lead.organization_id, lead.id],
    );
  } catch (error) {
    guardBlocked = error.code === "P0001";
    await client.query("ROLLBACK TO SAVEPOINT f007_direct_write");
  }
  await client.query("RELEASE SAVEPOINT f007_direct_write");
  const evidence = {
    changed: result.changed,
    destination: result.record.status,
    historyDelta: Number(after.rows[0].history) - Number(before.rows[0].history),
    outboxDelta: Number(after.rows[0].outbox) - Number(before.rows[0].outbox),
    directWriteBlocked: guardBlocked,
    configuration: {
      stableCode: configured.code === renamed.code,
      renamed: renamed.name.endsWith("renamed"),
      deactivated: inactive.status === "inactive",
      reactivated: reactivated.status === "active",
    },
    rolledBack: true,
  };
  if (!evidence.changed || evidence.destination !== "contacted" || evidence.historyDelta !== 1 || evidence.outboxDelta !== 1 || !evidence.directWriteBlocked || !Object.values(evidence.configuration).every(Boolean))
    throw new Error(`F007 live verification failed: ${JSON.stringify(evidence)}`);
  console.log(JSON.stringify(evidence));
} finally {
  await client.query("ROLLBACK");
  await client.end();
}
