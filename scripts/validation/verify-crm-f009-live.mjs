import { config } from "dotenv";
import pg from "pg";

import {
  archiveCrmRecord,
  createCrmRecord,
  updateCrmRecord,
} from "../../services/api/src/modules/crm/index.js";

config({ path: "apps/web/.env.local" });
const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("Set MIGRATION_DATABASE_URL or DATABASE_URL for F009 live verification.");

const client = new pg.Client({ connectionString });
await client.connect();
await client.query("BEGIN");
try {
  const fixture = await client.query(
    `SELECT p.organization_id,p.company_id,p.id AS pipeline_id,s.id AS stage_id
       FROM tenant.crm_pipelines p
       JOIN tenant.crm_pipeline_stages s
         ON s.organization_id=p.organization_id AND s.pipeline_id=p.id
      WHERE p.status='active' AND s.status='active'
      ORDER BY p.is_default DESC,s.sequence LIMIT 1`,
  );
  const base = fixture.rows[0];
  if (!base) throw new Error("No active CRM pipeline/stage exists for rolled-back F009 verification.");
  await client.query("SELECT set_config('app.current_organization_id',$1,true)", [base.organization_id]);

  const seller = await client.query(
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
      ORDER BY membership.created_at LIMIT 1`,
    [base.organization_id],
  );
  if (!seller.rows[0]) throw new Error("Verification organization has no active CRM-eligible member.");
  const context = {
    organizationId: base.organization_id,
    userId: seller.rows[0].user_id,
    activeCompanyId: base.company_id,
    activeBranchId: null,
    allowAllCompanies: true,
    roleSlugs: ["organization_owner"],
    permissions: ["crm.view", "crm.opportunities.manage", "crm.records.view_all"],
  };

  const created = await createCrmRecord(client, context, "opportunities", {
    name: "F009 rolled-back verification",
    companyId: base.company_id,
    pipelineId: base.pipeline_id,
    stageId: base.stage_id,
    amount: 1234.56,
    currencyCode: "INR",
    nextStep: "Validate Opportunity record lifecycle",
  });
  if (!created.id || created.status !== "open" || created.ownerUserId !== context.userId)
    throw new Error(`F009 create invariant failed: ${JSON.stringify(created)}`);

  const updated = await updateCrmRecord(client, context, "opportunities", created.id, {
    name: "F009 verification updated",
    nextStep: "Archive after verification",
  });
  if (updated.name !== "F009 verification updated") throw new Error("F009 update did not persist editable fields.");

  let forgedLifecycleBlocked = false;
  await client.query("SAVEPOINT f009_forge");
  try {
    await updateCrmRecord(client, context, "opportunities", created.id, { status: "won" });
  } catch (error) {
    forgedLifecycleBlocked = /governed Opportunity actions/i.test(String(error?.message || error));
    await client.query("ROLLBACK TO SAVEPOINT f009_forge");
  }
  await client.query("RELEASE SAVEPOINT f009_forge");

  const archived = await archiveCrmRecord(client, context, "opportunities", created.id);
  const replay = await archiveCrmRecord(client, context, "opportunities", created.id);
  if (archived.status !== "archived" || replay.status !== "archived") throw new Error("F009 archive/replay invariant failed.");

  const constraint = await client.query(
    `SELECT convalidated FROM pg_constraint
      WHERE conrelid='tenant.crm_opportunities'::regclass
        AND conname='crm_opportunities_stage_pipeline_f009_fkey'`,
  );
  const index = await client.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname='tenant' AND indexname='crm_opportunities_f009_scope_idx'`,
  );
  const result = {
    created: Boolean(created.id),
    ownerDefaulted: created.ownerUserId === context.userId,
    stagePipelineCoherent: created.pipelineId === base.pipeline_id && created.stageId === base.stage_id,
    editableUpdate: updated.name === "F009 verification updated",
    forgedLifecycleBlocked,
    archiveIdempotent: archived.status === "archived" && replay.status === "archived",
    compositeConstraint: constraint.rows[0]?.convalidated === true,
    scopeIndex: Boolean(index.rows[0]),
    rolledBack: true,
  };
  if (Object.values(result).some((value) => value !== true)) throw new Error(`F009 live verification failed: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result));
} finally {
  await client.query("ROLLBACK");
  await client.end();
}
