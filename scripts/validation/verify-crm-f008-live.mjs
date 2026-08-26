import { config } from "dotenv";
import pg from "pg";

import {
  assertLeadDuplicatePolicy,
  evaluateLeadDuplicateRisk,
  recordLeadDuplicateOverride,
} from "../../services/api/src/modules/crm/lead-duplicates.js";

config({ path: "apps/web/.env.local" });

const connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("Set MIGRATION_DATABASE_URL or DATABASE_URL for F008 live verification.");

const client = new pg.Client({ connectionString });
await client.connect();
await client.query("BEGIN");
try {
  const leadResult = await client.query(
    `SELECT organization_id,id,company_id,branch_id,owner_user_id,first_name,last_name,email,mobile,phone,company_name
       FROM tenant.crm_leads
      WHERE record_status IN ('active','archived','converted')
        AND (normalized_email IS NOT NULL OR normalized_mobile IS NOT NULL
          OR (normalized_name IS NOT NULL AND normalized_company_name IS NOT NULL))
      ORDER BY created_at LIMIT 1`,
  );
  const lead = leadResult.rows[0];
  if (!lead) throw new Error("No Lead with duplicate-test identity is available for rolled-back F008 verification.");
  await client.query("SELECT set_config('app.current_organization_id',$1,true)", [lead.organization_id]);
  const membership = await client.query(
    `SELECT user_id FROM public.organization_memberships
      WHERE organization_id=$1 AND status='active' ORDER BY created_at LIMIT 1`,
    [lead.organization_id],
  );
  if (!membership.rows[0]) throw new Error("The verification organization has no active member.");
  const context = {
    organizationId: lead.organization_id,
    userId: membership.rows[0].user_id,
    activeCompanyId: lead.company_id,
    activeBranchId: lead.branch_id,
    allowAllCompanies: true,
    roleSlugs: ["organization_owner"],
    permissions: ["crm.view", "crm.records.view_all", "crm.data-quality.manage"],
  };
  const input = {
    firstName: lead.first_name,
    lastName: lead.last_name,
    email: lead.email,
    mobile: lead.mobile,
    phone: lead.phone,
    companyName: lead.company_name,
  };
  const evaluation = await evaluateLeadDuplicateRisk(client, context, input, { lock: true });
  if (evaluation.classification === "none") throw new Error("Existing Lead did not match its own normalized identity.");

  let blocked = false;
  try {
    await assertLeadDuplicatePolicy(client, context, input, { lock: true });
  } catch (error) {
    blocked = error?.code === "CRM_LEAD_DUPLICATE_EXACT";
  }
  if (evaluation.classification === "exact" && !blocked)
    throw new Error("Exact duplicate policy did not block without an override.");

  let immutableEvidence = null;
  if (evaluation.classification === "exact") {
    const override = await assertLeadDuplicatePolicy(client, context, input, {
      lock: true,
      overrideReason: "F008 rolled-back live verification duplicate override reason",
    });
    const evidence = await recordLeadDuplicateOverride(
      client,
      context,
      lead.id,
      override,
      "update",
    );
    let immutable = false;
    await client.query("SAVEPOINT f008_immutable");
    try {
      await client.query(
        "UPDATE tenant.crm_lead_duplicate_overrides SET reason='mutated evidence should fail' WHERE organization_id=$1 AND id=$2",
        [lead.organization_id, evidence.id],
      );
    } catch {
      immutable = true;
      await client.query("ROLLBACK TO SAVEPOINT f008_immutable");
    }
    await client.query("RELEASE SAVEPOINT f008_immutable");
    immutableEvidence = { inserted: Boolean(evidence.id), immutable };
  }

  const indexes = await client.query(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname='tenant' AND indexname LIKE 'crm_leads_f008_%'`,
  );
  const forcedRls = await client.query(
    `SELECT relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='tenant' AND c.relname='crm_lead_duplicate_overrides'`,
  );
  const result = {
    classification: evaluation.classification,
    matches: evaluation.matches.length,
    exactBlocked: evaluation.classification !== "exact" || blocked,
    overrideEvidence: immutableEvidence,
    f008Indexes: indexes.rows.length,
    forcedRls: forcedRls.rows[0]?.relforcerowsecurity === true,
    rolledBack: true,
  };
  if (result.f008Indexes < 4 || !result.forcedRls || !result.exactBlocked || (immutableEvidence && (!immutableEvidence.inserted || !immutableEvidence.immutable)))
    throw new Error(`F008 live verification failed: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result));
} finally {
  await client.query("ROLLBACK");
  await client.end();
}
