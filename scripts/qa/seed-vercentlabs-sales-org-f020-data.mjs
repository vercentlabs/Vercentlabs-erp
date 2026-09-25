#!/usr/bin/env node
// F020 Territories and sales teams — the demo org had one team, one
// territory and no quota plans, too thin to show the hierarchy, member roles,
// territory types, team/user assignments or quotas. Seeds a small realistic
// sales organization through the governed createCrmRecord path (the same
// validation, company scope and cycle guards the settings screen uses).
// Local-only, idempotent by code / natural key.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { createCrmRecord } from "../../services/api/src/index.js";
import { setTenantContext } from "../../packages/database/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
}
const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!/localhost|127\.0\.0\.1/.test(connectionString)) throw new Error("Refusing to run against a non-local database.");
const ORG_NAME = process.env.SEED_ORG_NAME || "Vercentlabs";

async function main() {
  const admin = new Client({ connectionString });
  await admin.connect();
  const organizationId = (await admin.query(`SELECT id FROM organizations WHERE name=$1 LIMIT 1`, [ORG_NAME])).rows[0]?.id;
  if (!organizationId) throw new Error(`Organization "${ORG_NAME}" not found.`);
  const companyId = (await admin.query(`SELECT id FROM public.companies WHERE organization_id=$1 AND is_primary LIMIT 1`, [organizationId])).rows[0].id;
  const users = Object.fromEntries((await admin.query(
    `SELECT u.full_name, u.id FROM users u JOIN organization_memberships om ON om.user_id=u.id WHERE om.organization_id=$1 AND om.status='active'`,
    [organizationId],
  )).rows.map((row) => [row.full_name, row.id]));
  const owner = users["Atharva Chavan"];
  const context = {
    organizationId, userId: owner, activeCompanyId: companyId, activeBranchId: null, allowAllCompanies: true,
    permissions: ["crm.records.view_all", "crm.settings.manage"], roleSlugs: ["organization_owner"],
  };
  async function withTx(fn) {
    await admin.query("BEGIN");
    try { await setTenantContext(admin, organizationId); const r = await fn(admin); await admin.query("COMMIT"); return r; }
    catch (e) { await admin.query("ROLLBACK"); throw e; }
  }
  const one = async (sql, values) => (await admin.query(sql, values)).rows[0];

  console.log("Seeding F020 sales organization demo data...");

  async function team(code, name, managerName, parentCode) {
    const existing = await one(`SELECT id FROM tenant.crm_sales_teams WHERE organization_id=$1 AND code=$2`, [organizationId, code]);
    if (existing) { console.log(`Already present: team ${code}`); return existing.id; }
    const parentTeamId = parentCode ? (await one(`SELECT id FROM tenant.crm_sales_teams WHERE organization_id=$1 AND code=$2`, [organizationId, parentCode])).id : null;
    const record = await withTx((c) => createCrmRecord(c, context, "sales-teams", { companyId, code, name, managerUserId: users[managerName], parentTeamId, currencyCode: "INR", status: "active" }));
    console.log(`Created team ${code}`);
    return record.id;
  }
  const westId = await team("WEST-REGION", "West Region Sales", "Ananya Rao", null);
  await team("DIRECT-POD", "Direct Sales Pod", "Ananya Rao", null);
  const enterpriseId = await team("ENTERPRISE-WEST", "Enterprise Accounts — West", "Ananya Rao", "WEST-REGION");
  const insideId = await team("INSIDE-SALES", "Inside Sales", "Karan Mehta", "WEST-REGION");

  async function member(teamId, userName, memberRole, allocationPercent) {
    const existing = await one(`SELECT id FROM tenant.crm_sales_team_members WHERE organization_id=$1 AND team_id=$2 AND user_id=$3`, [organizationId, teamId, users[userName]]);
    if (existing) return console.log(`Already present: ${userName} in team`);
    await withTx((c) => createCrmRecord(c, context, "sales-team-members", { companyId, teamId, userId: users[userName], memberRole, allocationPercent, effectiveFrom: "2026-04-01", status: "active" }));
    console.log(`Added ${userName} (${memberRole})`);
  }
  await member(westId, "Ananya Rao", "manager", 100);
  await member(enterpriseId, "Priya Nair", "seller", 70);
  await member(enterpriseId, "Atharva Chavan", "overlay", 30);
  await member(insideId, "Karan Mehta", "manager", 100);
  await member(insideId, "Priya Nair", "seller", 30);

  async function territory(code, name, territoryType, managerName, parentCode) {
    const existing = await one(`SELECT id FROM tenant.crm_territories WHERE organization_id=$1 AND code=$2`, [organizationId, code]);
    if (existing) { console.log(`Already present: territory ${code}`); return existing.id; }
    const parentTerritoryId = parentCode ? (await one(`SELECT id FROM tenant.crm_territories WHERE organization_id=$1 AND code=$2`, [organizationId, parentCode])).id : null;
    const record = await withTx((c) => createCrmRecord(c, context, "territories", { companyId, code, name, territoryType, managerUserId: users[managerName], parentTerritoryId, status: "active" }));
    console.log(`Created territory ${code}`);
    return record.id;
  }
  const maharashtraId = await territory("MAHARASHTRA", "Maharashtra", "geographic", "Ananya Rao", null);
  const puneId = await territory("PUNE-CORRIDOR", "Pune Corridor", "geographic", "Ananya Rao", null);
  const mumbaiId = await territory("MUMBAI-METRO", "Mumbai Metro", "geographic", "Ananya Rao", "MAHARASHTRA");
  const logisticsId = await territory("LOGISTICS-VERTICAL", "Logistics & Freight", "industry", "Karan Mehta", null);

  async function assign(territoryId, assigneeType, assigneeId, assignmentRole) {
    const existing = await one(`SELECT id FROM tenant.crm_territory_assignments WHERE organization_id=$1 AND territory_id=$2 AND assignee_id=$3 AND effective_to IS NULL`, [organizationId, territoryId, assigneeId]);
    if (existing) return console.log("Already present: territory assignment");
    await withTx((c) => createCrmRecord(c, context, "territory-assignments", { companyId, territoryId, assigneeType, assigneeId, assignmentRole, effectiveFrom: "2026-04-01", source: "manual" }));
    console.log(`Assigned ${assigneeType} to territory (${assignmentRole})`);
  }
  await assign(mumbaiId, "team", enterpriseId, "primary");
  await assign(mumbaiId, "user", users["Priya Nair"], "primary");
  await assign(maharashtraId, "user", users["Ananya Rao"], "manager");
  await assign(logisticsId, "team", insideId, "primary");
  await assign(logisticsId, "user", users["Atharva Chavan"], "overlay");
  void puneId;

  async function quota(name, fields) {
    const existing = await one(`SELECT id FROM tenant.crm_quota_plans WHERE organization_id=$1 AND name=$2`, [organizationId, name]);
    if (existing) return console.log(`Already present: quota ${name}`);
    await withTx((c) => createCrmRecord(c, context, "quota-plans", { companyId, name, currencyCode: "INR", status: "active", ...fields }));
    console.log(`Created quota ${name}`);
  }
  await quota("FY26 H2 — West Region bookings", { teamId: westId, quotaType: "bookings", periodStart: "2026-10-01", periodEnd: "2027-03-31", targetAmount: 45000000, stretchAmount: 52000000 });
  await quota("FY26 Q3 — Mumbai Metro revenue", { territoryId: mumbaiId, quotaType: "revenue", periodStart: "2026-10-01", periodEnd: "2026-12-31", targetAmount: 12000000, stretchAmount: 15000000 });
  await quota("FY26 Q3 — Priya Nair new logos", { userId: users["Priya Nair"], quotaType: "new_logo", periodStart: "2026-10-01", periodEnd: "2026-12-31", targetAmount: 8 });

  console.log("Done.");
  await admin.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
