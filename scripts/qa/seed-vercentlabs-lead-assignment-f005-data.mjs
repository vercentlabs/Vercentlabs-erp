#!/usr/bin/env node
// F005 Lead Assignment — the "Vercentlabs" demo org had exactly one active
// member (its owner), which is enough to exercise fixed-mode routing but
// cannot demonstrate round-robin/workload rotation, territory coverage, or
// an out-of-office exclusion — all of which need a second and third
// eligible sales rep. This script creates three demo sales reps (raw SQL
// for user/membership/role-assignment rows, same convention
// scripts/qa/seed-e2e-fixture.mjs already uses — there is no governed
// "createUser" domain function; a person signs up or is invited, neither of
// which fits a local seed script), then configures a full, realistic
// F005 setup through the app's own governed functions: a territory, four
// assignment rules (one per mode), a fallback owner, and one active
// out-of-office window. Local-only, idempotent, same convention as the
// other scripts/qa/seed-*.mjs scripts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { saveLeadAssignmentPolicy, createCrmRecord, setLeadAssignmentFallback, setLeadAssigneeAvailability } from "../../services/api/src/index.js";
import { hashPassword } from "../../services/api/src/core/auth/session.js";
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
const QA_PASSWORD = "CrmQaFixture!2026";

const DEMO_REPS = [
  { firstName: "Priya", lastName: "Nair", email: "priya.nair@vercentlabs.demo" },
  { firstName: "Karan", lastName: "Mehta", email: "karan.mehta@vercentlabs.demo" },
  { firstName: "Ananya", lastName: "Rao", email: "ananya.rao@vercentlabs.demo" },
];

async function main() {
  const admin = new Client({ connectionString });
  await admin.connect();
  const org = (await admin.query(`SELECT id FROM organizations WHERE name=$1 LIMIT 1`, [ORG_NAME])).rows[0];
  if (!org) throw new Error(`Organization "${ORG_NAME}" not found.`);
  const organizationId = org.id;
  const owner = (await admin.query(
    `SELECT u.id, u.full_name FROM users u JOIN organization_memberships om ON om.user_id=u.id WHERE om.organization_id=$1 AND om.status='active' ORDER BY om.created_at ASC LIMIT 1`,
    [organizationId],
  )).rows[0];
  const company = (await admin.query(`SELECT id FROM companies WHERE organization_id=$1 ORDER BY created_at LIMIT 1`, [organizationId])).rows[0];
  const branch = (await admin.query(`SELECT id FROM branches WHERE company_id=$1 ORDER BY created_at LIMIT 1`, [company.id])).rows[0];
  const salesRepRole = (await admin.query(`SELECT id FROM roles WHERE organization_id=$1 AND slug='sales_representative'`, [organizationId])).rows[0];
  if (!salesRepRole) throw new Error(`"Sales Representative" role not found for ${ORG_NAME}.`);

  const context = {
    organizationId,
    userId: owner.id,
    activeCompanyId: company.id,
    activeBranchId: branch.id,
    allowAllCompanies: true,
    permissions: [],
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

  console.log(`Seeding F005 Lead Assignment demo data for "${ORG_NAME}" (${organizationId})...`);

  // --- 1. Three demo sales reps, active CRM members scoped to the one
  // company/branch, so both the settings screen's eligibility checks and a
  // real Lead's company/branch scope accept them.
  const repHash = await hashPassword(QA_PASSWORD);
  const repIds = {};
  for (const rep of DEMO_REPS) {
    let user = (await admin.query(`SELECT id FROM users WHERE lower(email)=lower($1)`, [rep.email])).rows[0];
    if (!user) {
      user = (await admin.query(
        `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,$4,'active',now()) RETURNING id`,
        [randomUUID(), rep.email, `${rep.firstName} ${rep.lastName}`, repHash],
      )).rows[0];
      console.log(`  user created: ${rep.firstName} ${rep.lastName}`);
    } else {
      console.log(`  user (already exists): ${rep.firstName} ${rep.lastName}`);
    }
    repIds[rep.firstName] = user.id;
    await admin.query(
      `INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')
       ON CONFLICT (organization_id,user_id) DO UPDATE SET status='active'`,
      [organizationId, user.id],
    );
    await admin.query(
      `INSERT INTO user_role_assignments(organization_id,user_id,role_id,is_primary,status) VALUES ($1,$2,$3,true,'active')
       ON CONFLICT (organization_id,user_id,role_id) DO UPDATE SET status='active'`,
      [organizationId, user.id, salesRepRole.id],
    );
    await admin.query(
      `INSERT INTO membership_company_access(organization_id,user_id,company_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [organizationId, user.id, company.id],
    );
    await admin.query(
      `INSERT INTO membership_branch_access(organization_id,user_id,branch_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [organizationId, user.id, branch.id],
    );
  }

  // --- 2. A territory covering the one branch, with Ananya as manager and
  // Karan as an assigned member — both count as active territory members
  // (assignment/eligibility.js's activeTerritoryUserIds unions both paths).
  let territory = (await admin.query(
    `SELECT id FROM tenant.crm_territories WHERE organization_id=$1 AND name=$2`,
    [organizationId, "Pune Corridor"],
  )).rows[0];
  if (!territory) {
    territory = await withTx((client) => createCrmRecord(client, context, "territories", {
      companyId: company.id,
      code: "PUNE-CORRIDOR",
      name: "Pune Corridor",
      territoryType: "geographic",
      managerUserId: repIds.Ananya,
      status: "active",
    }));
    console.log("  territory created: Pune Corridor (manager: Ananya Rao)");
  } else {
    console.log("  territory (already exists): Pune Corridor");
  }
  const existingAssignment = (await admin.query(
    `SELECT id FROM tenant.crm_territory_assignments WHERE organization_id=$1 AND territory_id=$2 AND assignee_id=$3`,
    [organizationId, territory.id, repIds.Karan],
  )).rows[0];
  if (!existingAssignment) {
    await withTx((client) => createCrmRecord(client, context, "territory-assignments", {
      companyId: company.id,
      territoryId: territory.id,
      assigneeType: "user",
      assigneeId: repIds.Karan,
      assignmentRole: "primary",
      effectiveFrom: new Date().toISOString().slice(0, 10),
      source: "manual",
    }));
    console.log("  territory member added: Karan Mehta -> Pune Corridor");
  } else {
    console.log("  territory member (already assigned): Karan Mehta -> Pune Corridor");
  }

  // --- 3. Four assignment rules, one per mode, in a realistic waterfall
  // order: a hot-lead fast lane, a website round robin, a workload-balanced
  // catch-all, and a territory rule for anything reaching that far.
  const sources = Object.fromEntries((await admin.query(
    `SELECT name, id FROM tenant.crm_lead_sources WHERE organization_id=$1`,
    [organizationId],
  )).rows.map((row) => [row.name, row.id]));
  const policyPlans = [
    {
      name: "Hot leads — direct to Priya",
      sequence: 10,
      mode: "fixed",
      assigneeUserId: repIds.Priya,
      criteria: { leadGrade: "hot" },
    },
    {
      name: "Website leads — round robin",
      sequence: 20,
      mode: "round_robin",
      memberUserIds: [repIds.Priya, repIds.Karan],
      criteria: { sourceId: sources["Company Website"] },
    },
    {
      name: "Everything else — workload balanced",
      sequence: 30,
      mode: "workload",
      memberUserIds: [repIds.Priya, repIds.Karan, repIds.Ananya],
      criteria: {},
    },
    {
      name: "Pune Corridor territory",
      sequence: 40,
      mode: "territory",
      territoryId: territory.id,
      criteria: { countryCode: "IN" },
    },
  ];
  const existingPolicies = (await admin.query(
    `SELECT name FROM tenant.crm_lead_assignment_policies WHERE organization_id=$1`,
    [organizationId],
  )).rows.map((row) => row.name);
  for (const plan of policyPlans) {
    if (existingPolicies.includes(plan.name)) {
      console.log(`  assignment rule (already exists): ${plan.name}`);
      continue;
    }
    await withTx((client) => saveLeadAssignmentPolicy(client, context, plan));
    console.log(`  assignment rule created: ${plan.name}`);
  }

  // --- 4. Fallback owner — the org owner, as the last-resort safety net.
  const fallback = (await admin.query(
    `SELECT fallback_user_id FROM tenant.crm_lead_assignment_fallback WHERE organization_id=$1`,
    [organizationId],
  )).rows[0];
  if (!fallback?.fallback_user_id) {
    await withTx((client) => setLeadAssignmentFallback(client, context, owner.id));
    console.log(`  fallback owner set: ${owner.full_name}`);
  } else {
    console.log("  fallback owner (already set)");
  }

  // --- 5. One active out-of-office window, spanning today, so the panel
  // shows a real currently-in-effect exclusion rather than an empty state.
  const existingWindow = (await admin.query(
    `SELECT id FROM tenant.crm_lead_assignee_availability WHERE organization_id=$1 AND user_id=$2 AND ends_at>now()`,
    [organizationId, repIds.Ananya],
  )).rows[0];
  if (!existingWindow) {
    const startsAt = new Date(Date.now() - 24 * 3600 * 1000);
    const endsAt = new Date(Date.now() + 4 * 24 * 3600 * 1000);
    await withTx((client) => setLeadAssigneeAvailability(client, context, {
      userId: repIds.Ananya,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      reason: "Annual leave",
    }));
    console.log("  out-of-office window created: Ananya Rao (annual leave)");
  } else {
    console.log("  out-of-office window (already active): Ananya Rao");
  }

  console.log("Done.");
  await admin.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
