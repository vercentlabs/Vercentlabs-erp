#!/usr/bin/env -S npx tsx
// Prompt 6 (final self-closing pass) — deterministic local E2E test
// authentication, provisioned from the repository's own architecture
// rather than a manually-typed, out-of-band credential (the prior gap:
// ERP_E2E_EMAIL/PASSWORD only ever existed because a human supplied them
// conversationally in an earlier session — see CRM_VNEXT_IMPLEMENTATION_
// REGISTER.md's own note on this).
//
// v2 (this pass): the first version of this script hand-copied pieces of
// the real onboarding flow into raw SQL (numbering series, module
// enablement, billing) and kept discovering — one full E2E run at a time —
// further pieces it had missed (CRM pipeline/stages/lead-stages/lifecycle
// graph/lost-reasons/tags/sales-team, the full ROLE_TEMPLATES role catalog,
// business-data-foundation, accounting-company init). Re-deriving the
// entire onboarding contract by hand is exactly the kind of drift this
// repo's own architecture doc (Part 1/9) already flagged once for this same
// file. This version calls the REAL seedOrganizationFoundation() (core/
// platform.ts) directly — the exact function POST /api/onboarding calls for
// every human-created organization — so the fixture org can never again
// silently diverge from what a real signup produces. tsx (a new, dev-only
// dependency) is what makes importing that real .ts module from a plain
// script possible without a bundler step.
//
// Idempotent and safe to re-run: looks up by the fixture's fixed natural
// keys (org slug, user emails) via ON CONFLICT, never creates a second
// duplicate fixture org, and rotates both users' passwords to a fresh
// random value every run (never reused, never committed) — "provision or
// reset a deterministic E2E user," not a one-time manual step.
//
// No credential is ever hardcoded or committed: passwords are generated
// at runtime via crypto.randomBytes and written only to the gitignored
// apps/web/.env.e2e.local file, which playwright.erp.config.ts loads.
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, type PoolClient } from "pg";
import { config as loadDotEnv } from "dotenv";
import { seedOrganizationFoundation } from "../src/core/platform";

const scrypt = promisify(scryptCallback);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");

for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, "apps/web/.env"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}

const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");

// Mirrors apps/web/src/core/auth.ts's hashPassword() exactly — same
// algorithm, same salt length, same derived-key length, same
// "scrypt$<saltHex>$<hashHex>" storage format — so the real login route's
// verifyPassword() accepts it without any special-casing for fixture data.
// Kept as a standalone copy rather than importing auth.ts itself, since
// auth.ts pulls in next/headers/next/navigation (React Server Component
// APIs) that assume a live Next.js request context this plain script never
// has — platform.ts/billing.ts (imported below) carry no such dependency.
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function randomPassword() {
  // Meets any plausible complexity policy (length, mixed case, digit,
  // symbol) without needing to inspect the real signup validator — this
  // password is never typed by a human and never needs to be memorable.
  return `E2e${randomBytes(18).toString("base64url")}!9`;
}

const ORG_SLUG = "crm-e2e-fixture";
const ORG_NAME = "CRM E2E Fixture Org";
const OWNER_EMAIL = "e2e-owner@crm-e2e-fixture.test";
const RESTRICTED_EMAIL = "e2e-restricted@crm-e2e-fixture.test";

// A deliberately narrow permission set for the restricted fixture user —
// CRM.view plus ordinary record-management permissions, but explicitly
// WITHOUT crm.leads.view_sensitive / crm.accounts.view_sensitive /
// crm.contacts.view_sensitive / crm.records.view_all / crm.privacy.manage
// — exactly the "restricted viewer" every sensitive-projection E2E spec in
// this repo already assumes exists. No ROLE_TEMPLATES entry is this
// narrow (the closest, sales_representative, deliberately DOES grant
// crm.leads.view_sensitive), so this stays a fixture-only role layered on
// top of the real seeded catalog rather than a stand-in for it.
const RESTRICTED_PERMISSIONS = [
  "crm.view",
  "crm.leads.manage",
  "crm.activities.manage",
  "crm.accounts.manage",
  "crm.communications.manage",
  "crm.opportunities.manage",
];

async function upsertUser(client: PoolClient, email: string, fullName: string, passwordHash: string) {
  const result = await client.query(
    `INSERT INTO users(id,email,full_name,password_hash,email_verified_at,status,password_changed_at,failed_login_attempts,locked_until)
     VALUES($1,$2,$3,$4,now(),'active',now(),0,NULL)
     ON CONFLICT (email) DO UPDATE SET
       password_hash=EXCLUDED.password_hash, status='active', email_verified_at=now(),
       failed_login_attempts=0, locked_until=NULL, password_changed_at=now(), full_name=EXCLUDED.full_name
     RETURNING id`,
    [randomUUID(), email, fullName, passwordHash],
  );
  return result.rows[0].id as string;
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");

    const ownerPassword = randomPassword();
    const restrictedPassword = randomPassword();
    const ownerId = await upsertUser(client, OWNER_EMAIL, "CRM E2E Owner", await hashPassword(ownerPassword));
    const restrictedId = await upsertUser(client, RESTRICTED_EMAIL, "CRM E2E Restricted Viewer", await hashPassword(restrictedPassword));

    // Reuse the existing org/company/branch on a re-run (looked up by the
    // fixture's fixed slug) rather than always minting new ids — otherwise
    // seedOrganizationFoundation's own ON CONFLICT DO NOTHING guards (keyed
    // on organization_id) would silently skip re-seeding on every rerun
    // after the first.
    const existingOrg = await client.query<{ id: string }>(`SELECT id FROM organizations WHERE slug=$1`, [ORG_SLUG]);
    const organizationId = existingOrg.rows[0]?.id || randomUUID();
    await client.query(
      `INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by,status)
       VALUES($1,$2,$3,'IN','Asia/Kolkata','INR',$4,'active')
       ON CONFLICT (id) DO UPDATE SET status='active'`,
      [organizationId, ORG_NAME, ORG_SLUG, ownerId],
    );

    const existingCompany = await client.query<{ id: string }>(`SELECT id FROM companies WHERE organization_id=$1 AND is_primary`, [organizationId]);
    const companyId = existingCompany.rows[0]?.id || randomUUID();
    await client.query(
      `INSERT INTO companies(id,organization_id,name,legal_name,country_code,base_currency,is_primary,code,status)
       VALUES($1,$2,'CRM E2E Fixture Co','CRM E2E Fixture Co Pvt Ltd','IN','INR',true,'E2EFIX','active')
       ON CONFLICT (id) DO UPDATE SET status='active'`,
      [companyId, organizationId],
    );

    const existingBranch = await client.query<{ id: string }>(`SELECT id FROM branches WHERE organization_id=$1 AND is_primary`, [organizationId]);
    const branchId = existingBranch.rows[0]?.id || randomUUID();
    await client.query(
      `INSERT INTO branches(id,organization_id,company_id,name,code,timezone,is_primary,status)
       VALUES($1,$2,$3,'Head Office','HO','Asia/Kolkata',true,'active')
       ON CONFLICT (id) DO UPDATE SET status='active'`,
      [branchId, organizationId, companyId],
    );

    for (const [userId, legacyRole] of [[ownerId, "owner"], [restrictedId, "member"]] as const) {
      await client.query(
        `INSERT INTO organization_memberships(organization_id,user_id,role,status)
         VALUES($1,$2,$3,'active')
         ON CONFLICT (organization_id,user_id) DO UPDATE SET status='active',role=EXCLUDED.role`,
        [organizationId, userId, legacyRole],
      );
      await client.query(
        `INSERT INTO user_preferences(organization_id,user_id,active_company_id,active_branch_id)
         VALUES($1,$2,$3,$4)
         ON CONFLICT (organization_id,user_id) DO UPDATE SET active_company_id=EXCLUDED.active_company_id,active_branch_id=EXCLUDED.active_branch_id`,
        [organizationId, userId, companyId, branchId],
      );
    }

    // The one call that replaces every hand-copied piece this script used
    // to carry: numbering_series (all ~28 entity types), the full
    // ROLE_TEMPLATES role catalogue + permissions + the owner's
    // organization_owner assignment, organization_modules (every released
    // module enabled), business-data-foundation, accounting-company init,
    // CRM foundation (pipeline/stages/settings/lead sources/lead stages +
    // lifecycle transitions/lost reasons/tags/primary sales team) and
    // billing (trialing subscription). Exactly what a real POST
    // /api/onboarding produces for input.ownerUserId.
    await seedOrganizationFoundation(client as unknown as PoolClient, {
      organizationId,
      ownerUserId: ownerId,
      companyId,
      branchId,
      timezone: "Asia/Kolkata",
    });

    // seedOrganizationFoundation only ever provisions the ONE owner user it
    // is given — the restricted fixture user's deliberately-narrow role
    // (not a stand-in for any ROLE_TEMPLATES entry, see the constant's own
    // comment above) is layered on afterward.
    const restrictedRole = await client.query<{ id: string }>(
      `INSERT INTO roles(id,organization_id,name,slug,status,module_key,is_system)
       VALUES($1,$2,'CRM Sales Representative (E2E fixture)','crm_sales_representative_e2e','active','crm',false)
       ON CONFLICT (organization_id,slug) DO UPDATE SET status='active'
       RETURNING id`,
      [randomUUID(), organizationId],
    );
    const restrictedRoleId = restrictedRole.rows[0].id;
    await client.query(`DELETE FROM role_permissions WHERE role_id=$1`, [restrictedRoleId]);
    for (const permissionKey of RESTRICTED_PERMISSIONS) {
      await client.query(
        `INSERT INTO role_permissions(role_id,permission_key) VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [restrictedRoleId, permissionKey],
      );
    }
    await client.query(
      `INSERT INTO user_role_assignments(organization_id,user_id,role_id,is_primary,starts_at,status)
       VALUES($1,$2,$3,true,now(),'active')
       ON CONFLICT (organization_id,user_id,role_id) DO UPDATE SET status='active',revoked_at=NULL,expires_at=NULL,starts_at=now()`,
      [organizationId, restrictedId, restrictedRoleId],
    );

    // The restricted user needs explicit company/branch access rows (its
    // role is NOT organization_owner, so it does not get the unrestricted
    // bypass) — the owner does not need these (seedOrganizationFoundation's
    // organization_owner role assignment already bypasses this check).
    await client.query(
      `INSERT INTO membership_company_access(organization_id,user_id,company_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [organizationId, restrictedId, companyId],
    );
    await client.query(
      `INSERT INTO membership_branch_access(organization_id,user_id,branch_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [organizationId, restrictedId, branchId],
    );

    // §27/§28 closeout — erp-experience.spec.ts's record-360 route checks
    // (lead-record-360, opportunity-record-360) require
    // ERP_E2E_LEAD_ID/ERP_E2E_OPPORTUNITY_ID, but nothing in this script
    // ever created a Lead/Opportunity fixture or wrote those env vars —
    // every `test:e2e:erp` run threw "ERP_E2E_LEAD_ID is required" before
    // this fix. Deterministic, idempotent (fixed codes, ON CONFLICT), using
    // the default pipeline/stage seedOrganizationFoundation already
    // created above. Sales' Quotation/Sales-Order fixtures are a separate
    // module's gap, not created here — out of Prompt 6's CRM scope.
    const leadResult = await client.query<{ id: string }>(
      `INSERT INTO tenant.crm_leads(id,organization_id,company_id,branch_id,code,first_name,last_name,email,mobile,company_name,status,owner_user_id,created_by,updated_by)
       VALUES($1,$2,$3,$4,'E2E-LEAD-001','E2E','Fixture Lead','e2e-lead@crm-e2e-fixture.test','+15550100200','E2E Fixture Co','new',$5,$5,$5)
       ON CONFLICT (organization_id,code) DO UPDATE SET status='new'
       RETURNING id`,
      [randomUUID(), organizationId, companyId, branchId, ownerId],
    );
    const leadId = leadResult.rows[0].id;

    const pipeline = await client.query<{ id: string }>(
      `SELECT id FROM tenant.crm_pipelines WHERE organization_id=$1 AND is_default LIMIT 1`,
      [organizationId],
    );
    const pipelineId = pipeline.rows[0].id;
    const stage = await client.query<{ id: string }>(
      `SELECT id FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND pipeline_id=$2 ORDER BY sequence LIMIT 1`,
      [organizationId, pipelineId],
    );
    const stageId = stage.rows[0].id;

    const opportunityResult = await client.query<{ id: string }>(
      `INSERT INTO tenant.crm_opportunities(id,organization_id,company_id,branch_id,code,pipeline_id,stage_id,lead_id,owner_user_id,name,amount,status,created_by,updated_by)
       VALUES($1,$2,$3,$4,'E2E-OPP-001',$5,$6,$7,$8,'E2E Fixture Opportunity',10000,'open',$8,$8)
       ON CONFLICT (organization_id,code) DO UPDATE SET status='open',pipeline_id=EXCLUDED.pipeline_id,stage_id=EXCLUDED.stage_id
       RETURNING id`,
      [randomUUID(), organizationId, companyId, branchId, pipelineId, stageId, leadId, ownerId],
    );
    const opportunityId = opportunityResult.rows[0].id;

    // Account (business_parties) + Contact fixtures — same "the responsive/
    // axe gate needs a real record-360 id" reasoning as Lead/Opportunity
    // above, for erp-experience.spec.ts's Account/Contact route coverage.
    const accountResult = await client.query<{ id: string }>(
      `INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,legal_name,gstin,status,created_by,updated_by)
       VALUES($1,$2,$3,'E2E-ACCT-001','customer','E2E Fixture Account','E2E Fixture Account Pvt Ltd','29ABCDE1234F1Z5','active',$4,$4)
       ON CONFLICT (organization_id,code) DO UPDATE SET status='active'
       RETURNING id`,
      [randomUUID(), organizationId, companyId, ownerId],
    );
    const accountId = accountResult.rows[0].id;

    const contactResult = await client.query<{ id: string }>(
      `INSERT INTO tenant.contacts(id,organization_id,party_id,first_name,last_name,email,is_primary,status,created_by,updated_by)
       VALUES($1,$2,$3,'E2E','Fixture Contact','e2e-contact@crm-e2e-fixture.test',true,'active',$4,$4)
       ON CONFLICT (organization_id,party_id) WHERE is_primary AND status='active'
       DO UPDATE SET status='active'
       RETURNING id`,
      [randomUUID(), organizationId, accountId, ownerId],
    );
    const contactId = contactResult.rows[0].id;

    await client.query("COMMIT");

    const envPath = path.join(root, "apps/web/.env.e2e.local");
    const contents = [
      "# Generated by scripts/e2e-fixture-bootstrap.mts — do not commit, do not edit by hand.",
      "# Re-run: pnpm --filter @vercentlabs/web e2e:bootstrap",
      `ERP_E2E_EMAIL=${OWNER_EMAIL}`,
      `ERP_E2E_PASSWORD=${ownerPassword}`,
      `ERP_E2E_RESTRICTED_EMAIL=${RESTRICTED_EMAIL}`,
      `ERP_E2E_RESTRICTED_PASSWORD=${restrictedPassword}`,
      `ERP_E2E_LEAD_ID=${leadId}`,
      `ERP_E2E_OPPORTUNITY_ID=${opportunityId}`,
      `ERP_E2E_ACCOUNT_ID=${accountId}`,
      `ERP_E2E_CONTACT_ID=${contactId}`,
      "",
    ].join("\n");
    fs.writeFileSync(envPath, contents, "utf8");
    console.log(`E2E fixture ready: organization ${ORG_SLUG} (${organizationId})`);
    console.log(`  owner:      ${OWNER_EMAIL}`);
    console.log(`  restricted: ${RESTRICTED_EMAIL}`);
    console.log(`Credentials written to ${path.relative(root, envPath)} (gitignored).`);

    // §E2E closeout: playwright.erp.config.ts loads .env.local BEFORE
    // .env.e2e.local with override:false, so a stale ERP_E2E_* value left
    // in .env.local from an earlier, now-orphaned fixture organization
    // silently shadows this run's freshly-generated value forever — no
    // error, just a 404 for a record that "exists" only in an env var no
    // one is looking at. Found and root-caused via a live repro (a real
    // record id resolved to an Opportunity belonging to a completely
    // different, orphaned organization). Warn loudly so this can't recur
    // silently for the next engineer.
    const localEnvPath = path.join(root, "apps/web/.env.local");
    if (fs.existsSync(localEnvPath)) {
      const localEnvKeys = fs
        .readFileSync(localEnvPath, "utf8")
        .split("\n")
        .map((line) => line.match(/^([A-Z0-9_]+)=/)?.[1])
        .filter((key): key is string => Boolean(key));
      const shadowed = ["ERP_E2E_EMAIL", "ERP_E2E_PASSWORD", "ERP_E2E_RESTRICTED_EMAIL", "ERP_E2E_RESTRICTED_PASSWORD", "ERP_E2E_LEAD_ID", "ERP_E2E_OPPORTUNITY_ID", "ERP_E2E_ACCOUNT_ID", "ERP_E2E_CONTACT_ID"]
        .filter((key) => localEnvKeys.includes(key));
      if (shadowed.length) {
        console.warn(
          `WARNING: apps/web/.env.local already defines ${shadowed.join(", ")} — playwright.erp.config.ts loads ` +
            `.env.local BEFORE .env.e2e.local with override:false, so these stale value(s) will silently win over ` +
            `the fresh ones just written above. Remove them from .env.local unless you intend a deliberate manual override.`,
        );
      }
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("E2E fixture bootstrap failed:", error);
  process.exit(1);
});
