#!/usr/bin/env node
// Creates the fixture the Playwright suite signs in with, from an empty database, using the application's own
// registration and CRM functions (no hand-written INSERTs for CRM records). Writes apps/web/.env.e2e.local, which
// apps/web/e2e/fixtures.ts reads. Safe to run twice: it reuses the organization if the owner already exists.
//
// Refuses to run against a database that is not local unless E2E_SEED_ALLOW_REMOTE=1 (CI sets it for its own
// throwaway service container).
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";

import { createCrmAccount, createCrmContact, createCrmRecord, createSalesStage, registerOrganization } from "../../services/api/src/index.js";
import { hashPassword } from "../../services/api/src/core/session.js";
import { setTenantContext } from "../../packages/database/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}

const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!/localhost|127\.0\.0\.1/.test(connectionString) && process.env.E2E_SEED_ALLOW_REMOTE !== "1") {
  throw new Error("Refusing to run against a non-local database. Set E2E_SEED_ALLOW_REMOTE=1 for a throwaway CI database.");
}

const OWNER_EMAIL = process.env.ERP_E2E_EMAIL || "e2e-owner@crm-e2e-fixture.test";
const RESTRICTED_EMAIL = process.env.ERP_E2E_RESTRICTED_EMAIL || "e2e-restricted@crm-e2e-fixture.test";
const PASSWORD = process.env.ERP_E2E_PASSWORD || `E2e-${randomUUID().slice(0, 8)}-Fixture!9`;
const RESTRICTED_PASSWORD = process.env.ERP_E2E_RESTRICTED_PASSWORD || PASSWORD;
const RESTRICTED_ROLE_SLUG = "crm_sales_representative_e2e";
const RESTRICTED_PERMISSIONS = [
  "crm.view",
  "crm.leads.manage",
  "crm.accounts.manage",
  "crm.opportunities.manage",
  "crm.activities.manage",
  "crm.communications.manage",
];

const db = new Client({ connectionString });
await db.connect();

async function inTenant(organizationId, work) {
  await db.query("BEGIN");
  try {
    await setTenantContext(db, organizationId);
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

try {
  // ---- organization and owner
  let owner = (await db.query(`SELECT u.id, m.organization_id FROM users u JOIN organization_memberships m ON m.user_id=u.id WHERE lower(u.email)=lower($1) LIMIT 1`, [OWNER_EMAIL])).rows[0];
  if (!owner) {
    await db.query("BEGIN");
    try {
      const registered = await registerOrganization(db, {
        fullName: "E2E Owner",
        email: OWNER_EMAIL,
        password: PASSWORD,
        organizationName: "CRM E2E Fixture",
        countryCode: "IN",
        baseCurrency: "INR",
        timezone: "Asia/Kolkata",
      });
      await db.query("COMMIT");
      owner = { id: registered.userId, organization_id: registered.organizationId };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  } else {
    await db.query(`UPDATE users SET password_hash=$2, password_changed_at=now() WHERE id=$1`, [owner.id, await hashPassword(PASSWORD)]);
  }
  const organizationId = owner.organization_id;
  await db.query(`UPDATE users SET email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1`, [owner.id]);

  // ---- company and branch
  let company = (await db.query(`SELECT id FROM companies WHERE organization_id=$1 ORDER BY created_at LIMIT 1`, [organizationId])).rows[0];
  if (!company) {
    company = (await db.query(
      `INSERT INTO companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status)
       VALUES ($1,$2,'E2E Fixture Co','E2E Fixture Co','E2E','INR','IN',true,'active') RETURNING id`,
      [randomUUID(), organizationId],
    )).rows[0];
  }
  let branch = (await db.query(`SELECT id FROM branches WHERE company_id=$1 ORDER BY created_at LIMIT 1`, [company.id])).rows[0];
  if (!branch) {
    branch = (await db.query(
      `INSERT INTO branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active') RETURNING id`,
      [randomUUID(), organizationId, company.id],
    )).rows[0];
  }

  // ---- restricted user: a sales representative who manages their own pipeline and nothing administrative
  let restricted = (await db.query(`SELECT id FROM users WHERE lower(email)=lower($1)`, [RESTRICTED_EMAIL])).rows[0];
  const restrictedHash = await hashPassword(RESTRICTED_PASSWORD);
  if (!restricted) {
    restricted = (await db.query(
      `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'E2E Restricted',$3,'active',now()) RETURNING id`,
      [randomUUID(), RESTRICTED_EMAIL, restrictedHash],
    )).rows[0];
  } else {
    await db.query(`UPDATE users SET password_hash=$2, password_changed_at=now(), email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1`, [restricted.id, restrictedHash]);
  }
  await db.query(
    `INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')
     ON CONFLICT (organization_id,user_id) DO UPDATE SET status='active'`,
    [organizationId, restricted.id],
  );
  let role = (await db.query(`SELECT id FROM roles WHERE organization_id=$1 AND slug=$2`, [organizationId, RESTRICTED_ROLE_SLUG])).rows[0];
  if (!role) {
    role = (await db.query(
      `INSERT INTO roles(id,organization_id,name,slug,description,is_system,status,module_key,assignable,risk_level,version)
       VALUES ($1,$2,'CRM sales representative (e2e)',$3,'',false,'active','crm',true,'standard',1) RETURNING id`,
      [randomUUID(), organizationId, RESTRICTED_ROLE_SLUG],
    )).rows[0];
  }
  await db.query(
    `INSERT INTO role_permissions(role_id,permission_key)
       SELECT $1, k FROM unnest($2::text[]) AS k WHERE EXISTS (SELECT 1 FROM permissions p WHERE p.key=k)
     ON CONFLICT DO NOTHING`,
    [role.id, RESTRICTED_PERMISSIONS],
  );
  const assigned = (await db.query(`SELECT 1 FROM user_role_assignments WHERE organization_id=$1 AND user_id=$2 AND role_id=$3`, [organizationId, restricted.id, role.id])).rows[0];
  if (!assigned) {
    await db.query(`INSERT INTO user_role_assignments(organization_id,user_id,role_id,is_primary,status) VALUES ($1,$2,$3,true,'active')`, [organizationId, restricted.id, role.id]);
  }

  // ---- CRM records the specs open by id
  const context = {
    organizationId,
    userId: owner.id,
    activeCompanyId: company.id,
    activeBranchId: branch.id,
    allowAllCompanies: true,
    permissions: [],
    roleSlugs: ["organization_owner"],
  };
  const marker = "E2E Fixture";
  const existingId = async (sql, params) => (await inTenant(organizationId, (c) => c.query(sql, params))).rows[0]?.id;

  let accountId = await existingId(`SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND display_name=$2 LIMIT 1`, [organizationId, `${marker} Account`]);
  if (!accountId) {
    accountId = (await inTenant(organizationId, (c) => createCrmAccount(c, context, {
      displayName: `${marker} Account`, industry: "Manufacturing", city: "Pune", state: "Maharashtra", countryCode: "IN", currencyCode: "INR", partyType: "customer",
    }))).id;
  }
  let contactId = await existingId(`SELECT id FROM tenant.contacts WHERE organization_id=$1 AND first_name=$2 LIMIT 1`, [organizationId, marker]).catch(() => undefined);
  if (!contactId) {
    contactId = (await inTenant(organizationId, (c) => createCrmContact(c, context, {
      firstName: marker, lastName: "Contact", email: "fixture.contact@example.com", mobile: "+91 9000000001", accountId,
    }))).id;
  }
  let leadId = await existingId(`SELECT id FROM tenant.crm_leads WHERE organization_id=$1 AND company_name=$2 LIMIT 1`, [organizationId, `${marker} Lead Co`]);
  if (!leadId) {
    leadId = (await inTenant(organizationId, (c) => createCrmRecord(c, context, "leads", {
      firstName: marker, lastName: "Lead", email: "fixture.lead@example.com", mobile: "+91 9000000002", companyName: `${marker} Lead Co`, countryCode: "IN",
    }))).id;
  }
  // Opportunities need an active pipeline with an open stage; a new organisation starts with none.
  let pipelineId = await existingId(`SELECT id FROM tenant.crm_pipelines WHERE organization_id=$1 AND status='active' ORDER BY is_default DESC, created_at LIMIT 1`, [organizationId]);
  if (!pipelineId) {
    pipelineId = (await inTenant(organizationId, (c) => c.query(
      `INSERT INTO tenant.crm_pipelines(organization_id,company_id,name,code,description,is_default,status,created_by,updated_by)
       VALUES ($1,NULL,'Sales pipeline','sales','Default pipeline for the e2e fixture',true,'active',$2,$2) RETURNING id`,
      [organizationId, owner.id],
    ))).rows[0].id;
  }
  const stageCount = Number((await inTenant(organizationId, (c) => c.query(`SELECT count(*)::int AS n FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND pipeline_id=$2`, [organizationId, pipelineId]))).rows[0].n);
  if (stageCount === 0) {
    for (const stage of [
      { name: "Qualification", stageType: "open", probability: 20, forecastCategory: "pipeline", staleAfterDays: 14 },
      { name: "Proposal", stageType: "open", probability: 50, forecastCategory: "best_case", staleAfterDays: 14 },
      { name: "Negotiation", stageType: "open", probability: 75, forecastCategory: "committed", staleAfterDays: 14 },
      { name: "Closed won", stageType: "won" },
      { name: "Closed lost", stageType: "lost" },
    ]) {
      await inTenant(organizationId, (c) => createSalesStage(c, context, { pipelineId, ...stage }));
    }
  }
  let opportunityId = await existingId(`SELECT id FROM tenant.crm_opportunities WHERE organization_id=$1 AND name=$2 LIMIT 1`, [organizationId, `${marker} Opportunity`]);
  if (!opportunityId) {
    const in30Days = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    opportunityId = (await inTenant(organizationId, (c) => createCrmRecord(c, context, "opportunities", {
      name: `${marker} Opportunity`, partyId: accountId, amount: 250000, currencyCode: "INR", expectedCloseDate: in30Days,
    }))).id;
  }

  const lines = [
    "# Generated by scripts/qa/seed-e2e-fixture.mjs. Do not commit.",
    `ERP_E2E_EMAIL=${OWNER_EMAIL}`,
    `ERP_E2E_PASSWORD=${PASSWORD}`,
    `ERP_E2E_RESTRICTED_EMAIL=${RESTRICTED_EMAIL}`,
    `ERP_E2E_RESTRICTED_PASSWORD=${RESTRICTED_PASSWORD}`,
    `ERP_E2E_LEAD_ID=${leadId}`,
    `ERP_E2E_OPPORTUNITY_ID=${opportunityId}`,
    `ERP_E2E_ACCOUNT_ID=${accountId}`,
    `ERP_E2E_CONTACT_ID=${contactId}`,
  ];
  const target = process.env.E2E_ENV_FILE || path.join(root, "apps/web/.env.e2e.local");
  fs.writeFileSync(target, lines.join("\n") + "\n");
  console.log(`Fixture ready for organization ${organizationId}. Wrote ${path.relative(root, target)}.`);
} finally {
  await db.end();
}
