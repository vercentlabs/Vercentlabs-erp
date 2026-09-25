#!/usr/bin/env node
// F010 Opportunity pipeline — the demo org's one real pipeline ("Sales
// Pipeline") has 143 real open Opportunities, but every one of them sits in
// "Qualification"; Needs Analysis/Proposal/Negotiation are completely empty,
// so the pipeline board would show three blank columns with nothing to
// screenshot. This seeds one real, governed demo Opportunity into each of
// those three stages (created then walked forward stage-by-stage through
// moveOpportunityStage, never a raw stage_id UPDATE — stage_entered_at is
// governed and a direct write would trip the lifecycle guard, migration 098).
//
// Also seeds one restricted demo user (crm.view only, no
// crm.opportunities.manage) in the SAME real Vercentlabs org, purely to
// demonstrate F010's own gap-closure: the Pipeline board previously
// rendered drag handles and the move menu unconditionally for every viewer;
// it's now permission-gated, and there was no restricted user anywhere in
// this org to actually see that gate in the live product.
//
// Deliberately does NOT touch tenant.crm_opportunity_stage_sla_policies
// here — demonstrating the breached/bottleneck state needs a temporary,
// very tight SLA override on the real Qualification stage (whose 137
// already-aged real Opportunities would otherwise never show it), and that
// override is posed and reverted live through the actual Settings UI by the
// screenshot script itself, not left as permanent seeded configuration that
// would flip 137 real deals to "stalled" org-wide.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { createCrmRecord, moveOpportunityStage, updateCrmRecord } from "../../services/api/src/index.js";
import { hashPassword } from "../../services/api/src/core/session.js";
import { setTenantContext } from "../../packages/database/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}
const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!/localhost|127\.0\.0\.1/.test(connectionString)) throw new Error("Refusing to run against a non-local database.");

const ORG_NAME = process.env.SEED_ORG_NAME || "Vercentlabs";
const RESTRICTED_EMAIL = "f010.restricted@vercentlabs.demo";
const RESTRICTED_PASSWORD = "CrmQaFixture!2026";
const RESTRICTED_ROLE_SLUG = "crm_pipeline_viewer_f010";

async function main() {
  const admin = new Client({ connectionString });
  await admin.connect();
  const org = (await admin.query(`SELECT id FROM organizations WHERE name=$1 LIMIT 1`, [ORG_NAME])).rows[0];
  if (!org) throw new Error(`Organization "${ORG_NAME}" not found.`);
  const organizationId = org.id;
  const owner = (await admin.query(
    `SELECT id FROM users u JOIN organization_memberships om ON om.user_id=u.id WHERE om.organization_id=$1 AND om.status='active' ORDER BY om.created_at ASC LIMIT 1`,
    [organizationId],
  )).rows[0];
  const company = (await admin.query(`SELECT id FROM companies WHERE organization_id=$1 ORDER BY created_at LIMIT 1`, [organizationId])).rows[0];
  const context = {
    organizationId,
    userId: owner.id,
    activeCompanyId: company?.id ?? null,
    allowAllCompanies: true,
    permissions: ["crm.records.view_all", "crm.opportunities.manage"],
    roleSlugs: ["organization_owner"],
  };

  async function withTx(fn) {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, organizationId);
      const result = await fn(admin);
      await admin.query("COMMIT");
      return result;
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
  }

  console.log(`Seeding F010 Opportunity pipeline demo data for "${ORG_NAME}" (${organizationId})...`);

  const pipeline = (await admin.query(
    `SELECT id FROM tenant.crm_pipelines WHERE organization_id=$1 AND status='active' ORDER BY is_default DESC, created_at LIMIT 1`,
    [organizationId],
  )).rows[0];
  if (!pipeline) throw new Error("Expected an active pipeline to already exist.");
  const stages = (await admin.query(
    `SELECT id, name, sequence FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND pipeline_id=$2 AND status='active' AND is_won=false AND is_lost=false ORDER BY sequence`,
    [organizationId, pipeline.id],
  )).rows;
  if (stages.length < 2) throw new Error("Expected at least two open stages in the default pipeline.");

  const account = (await admin.query(
    `SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND status='active' ORDER BY created_at LIMIT 1`,
    [organizationId],
  )).rows[0];

  // --- 1. One demo Opportunity walked into every open stage past the
  // first, so the board shows something in every column. Idempotent by
  // name; walks forward one governed hop at a time from wherever it
  // currently sits, so re-running after a partial failure still converges.
  for (const targetStage of stages.slice(1)) {
    const name = `F010 Demo — ${targetStage.name} Deal`;
    let current = (await admin.query(
      `SELECT id, stage_id, updated_at FROM tenant.crm_opportunities WHERE organization_id=$1 AND name=$2`,
      [organizationId, name],
    )).rows[0];
    if (!current) {
      const created = await withTx((client) => createCrmRecord(client, context, "opportunities", {
        name,
        partyId: account?.id ?? null,
        amount: 100000 + targetStage.sequence * 50000,
        currencyCode: "INR",
        nextStep: `Advance past ${targetStage.name}`,
        expectedCloseDate: new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10),
      }));
      current = { id: created.id, stage_id: created.stageId, updated_at: created.updatedAt };
      console.log(`  opportunity created: ${name}`);
    } else {
      console.log(`  opportunity (already exists): ${name}`);
    }
    while (current.stage_id !== targetStage.id) {
      const currentIndex = stages.findIndex((s) => s.id === current.stage_id);
      const nextStage = currentIndex >= 0 && currentIndex + 1 < stages.length ? stages[currentIndex + 1] : targetStage;
      const moved = await withTx((client) => moveOpportunityStage(client, context, current.id, nextStage.id, "F010 demo — advancing toward target stage.", {
        expectedUpdatedAt: current.updated_at,
        expectedStageId: current.stage_id,
      }));
      current = { id: current.id, stage_id: moved.stageId, updated_at: moved.updatedAt };
    }
    console.log(`    now in stage: ${targetStage.name}`);
  }

  // --- 2. A restricted demo user (crm.view only) so the board's permission
  // gating (F010 gap-closure — drag/move affordances previously rendered
  // unconditionally for every viewer) has a real login to demonstrate it.
  let restricted = (await admin.query(`SELECT id FROM users WHERE lower(email)=lower($1)`, [RESTRICTED_EMAIL])).rows[0];
  const restrictedHash = await hashPassword(RESTRICTED_PASSWORD);
  if (!restricted) {
    restricted = (await admin.query(
      `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'Rahul Iyer',$3,'active',now()) RETURNING id`,
      [randomUUID(), RESTRICTED_EMAIL, restrictedHash],
    )).rows[0];
    console.log(`  restricted user created: ${RESTRICTED_EMAIL}`);
  } else {
    await admin.query(`UPDATE users SET password_hash=$2, password_changed_at=now(), email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1`, [restricted.id, restrictedHash]);
    console.log(`  restricted user (already exists): ${RESTRICTED_EMAIL}`);
  }
  await admin.query(
    `INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')
     ON CONFLICT (organization_id,user_id) DO UPDATE SET status='active'`,
    [organizationId, restricted.id],
  );
  // companyVisible()'s predicate (resource-options.js/record-policy.js) is
  // "allowAllCompanies OR (activeCompanyId IS NOT NULL AND ...)" — a member
  // with no membership_company_access row gets a null activeCompanyId and
  // therefore sees NO company-scoped resource at all (not even org-wide
  // ones), regardless of any other permission. record-policy.js's
  // recordScope() applies the identical fail-closed pattern for branch too
  // (found live: the pipeline picker worked with company access alone, but
  // the board itself stayed empty until branch access was granted as well —
  // Opportunities carry a branchId field recordScope() checks, options
  // queries like getCrmOptions's pipelines list do not). Every real member
  // of this org already has both rows; a restricted demo user needs them
  // too or the Pipeline board would show nothing at all regardless of
  // ownership.
  if (company) {
    await admin.query(
      `INSERT INTO membership_company_access(organization_id,user_id,company_id) VALUES ($1,$2,$3)
       ON CONFLICT (organization_id,user_id,company_id) DO NOTHING`,
      [organizationId, restricted.id, company.id],
    );
    const branch = (await admin.query(`SELECT id FROM branches WHERE organization_id=$1 AND company_id=$2 ORDER BY created_at LIMIT 1`, [organizationId, company.id])).rows[0];
    if (branch) {
      await admin.query(
        `INSERT INTO membership_branch_access(organization_id,user_id,branch_id) VALUES ($1,$2,$3)
         ON CONFLICT (organization_id,user_id,branch_id) DO NOTHING`,
        [organizationId, restricted.id, branch.id],
      );
    }
  }
  let role = (await admin.query(`SELECT id FROM roles WHERE organization_id=$1 AND slug=$2`, [organizationId, RESTRICTED_ROLE_SLUG])).rows[0];
  if (!role) {
    role = (await admin.query(
      `INSERT INTO roles(id,organization_id,name,slug,description,is_system,status,module_key,assignable,risk_level,version)
       VALUES ($1,$2,'CRM pipeline viewer (F010 demo)',$3,'View-only CRM access, no Opportunity management — demonstrates the Pipeline board''s permission gating.',false,'active','crm',true,'standard',1) RETURNING id`,
      [randomUUID(), organizationId, RESTRICTED_ROLE_SLUG],
    )).rows[0];
    console.log(`  restricted role created: ${RESTRICTED_ROLE_SLUG}`);
  }
  await admin.query(
    `INSERT INTO role_permissions(role_id,permission_key)
       SELECT $1, k FROM unnest($2::text[]) AS k WHERE EXISTS (SELECT 1 FROM permissions p WHERE p.key=k)
     ON CONFLICT DO NOTHING`,
    [role.id, ["crm.view"]],
  );
  const assigned = (await admin.query(`SELECT 1 FROM user_role_assignments WHERE organization_id=$1 AND user_id=$2 AND role_id=$3`, [organizationId, restricted.id, role.id])).rows[0];
  if (!assigned) {
    await admin.query(`INSERT INTO user_role_assignments(organization_id,user_id,role_id,is_primary,status) VALUES ($1,$2,$3,true,'active')`, [organizationId, restricted.id, role.id]);
    console.log(`  restricted role assigned to ${RESTRICTED_EMAIL}`);
  }

  // --- 3. Give the restricted viewer ownership of one demo Opportunity —
  // otherwise their (correctly, separately owner-scoped) board would show
  // zero cards at all, which demonstrates permission gating far less
  // convincingly than a real read-only card with no move menu on it.
  const ownedDeal = (await admin.query(
    `SELECT id, owner_user_id FROM tenant.crm_opportunities WHERE organization_id=$1 AND name=$2`,
    [organizationId, "Suvidha Logistics Pvt Ltd — Route Planning Module"],
  )).rows[0];
  if (ownedDeal && ownedDeal.owner_user_id !== restricted.id) {
    await withTx((client) => updateCrmRecord(client, context, "opportunities", ownedDeal.id, { ownerUserId: restricted.id }));
    console.log(`  reassigned "Suvidha Logistics Pvt Ltd — Route Planning Module" to ${RESTRICTED_EMAIL}`);
  }

  console.log("Done.");
  await admin.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
