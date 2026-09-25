#!/usr/bin/env node
// F024 Pipeline dashboard — the demo org's open deals were almost all owned by
// one user, with a single won and a single lost deal, so the new scope (mine /
// my team / all) and period (won, lost, win rate) views had nothing to
// distinguish. Spreads deal ownership across the sales reps, makes the QA
// owner the manager of one team (so "My team" differs from "Mine"), and
// closes a handful of deals as won/lost with outcome reasons — all through
// the governed updateCrmRecord / moveOpportunityStage paths. Local-only,
// idempotent (guarded by counts and existing state).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { moveOpportunityStage, updateCrmRecord } from "../../services/api/src/index.js";
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
// Records other feature screenshots rely on — never reassigned or closed here.
const PROTECTED = ["Suvidha Logistics Pvt Ltd — Custom Reporting Add-on", "Suvidha Logistics Pvt Ltd — Cold Chain Monitoring"];

async function main() {
  const admin = new Client({ connectionString });
  await admin.connect();
  const organizationId = (await admin.query(`SELECT id FROM organizations WHERE name=$1 LIMIT 1`, [ORG_NAME])).rows[0]?.id;
  if (!organizationId) throw new Error(`Organization "${ORG_NAME}" not found.`);
  const users = Object.fromEntries((await admin.query(
    `SELECT u.full_name, u.id FROM users u JOIN organization_memberships om ON om.user_id=u.id WHERE om.organization_id=$1 AND om.status='active'`,
    [organizationId],
  )).rows.map((row) => [row.full_name, row.id]));
  const owner = users["Atharva Chavan"];
  const context = {
    organizationId, userId: owner, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true,
    permissions: ["crm.records.view_all", "crm.settings.manage", "crm.opportunities.manage"], roleSlugs: ["organization_owner"],
  };
  async function withTx(fn) {
    await admin.query("BEGIN");
    try { await setTenantContext(admin, organizationId); const r = await fn(admin); await admin.query("COMMIT"); return r; }
    catch (e) { await admin.query("ROLLBACK"); throw e; }
  }
  console.log("Seeding F024 pipeline dashboard demo data...");

  // 1. The QA owner manages "Enterprise Accounts — West" (Priya Nair is a member).
  const team = (await admin.query(`SELECT id, manager_user_id, updated_at FROM tenant.crm_sales_teams WHERE organization_id=$1 AND code='ENTERPRISE-WEST'`, [organizationId])).rows[0];
  if (!team) throw new Error("Run seed-vercentlabs-sales-org-f020-data.mjs first (team ENTERPRISE-WEST missing).");
  if (team.manager_user_id !== owner) {
    await withTx((c) => updateCrmRecord(c, context, "sales-teams", team.id, { managerUserId: owner }, { expectedUpdatedAt: team.updated_at.toISOString() }));
    console.log("Atharva Chavan now manages Enterprise Accounts — West");
  } else console.log("Already present: team manager");

  // 2. Spread open-deal ownership.
  const plan = [["Priya Nair", 30], ["Karan Mehta", 20], ["Ananya Rao", 12]];
  for (const [name, target] of plan) {
    const have = Number((await admin.query(`SELECT count(*)::int n FROM tenant.crm_opportunities WHERE organization_id=$1 AND owner_user_id=$2`, [organizationId, users[name]])).rows[0].n);
    if (have >= target) { console.log(`Already present: ${name} owns ${have} deals`); continue; }
    const candidates = (await admin.query(
      `SELECT id, updated_at FROM tenant.crm_opportunities WHERE organization_id=$1 AND status='open' AND owner_user_id=$2 AND NOT (name = ANY($3::text[])) ORDER BY code LIMIT $4`,
      [organizationId, owner, PROTECTED, target - have],
    )).rows;
    for (const row of candidates) await withTx((c) => updateCrmRecord(c, context, "opportunities", row.id, { ownerUserId: users[name] }, { expectedUpdatedAt: row.updated_at.toISOString() }));
    console.log(`Assigned ${candidates.length} open deals to ${name}`);
  }

  // 3. Close a few deals this month (won with a reason, lost with a reason).
  const stages = Object.fromEntries((await admin.query(`SELECT name, id FROM tenant.crm_pipeline_stages WHERE organization_id=$1`, [organizationId])).rows.map((row) => [row.name, row.id]));
  const reasons = Object.fromEntries((await admin.query(`SELECT outcome_type, id FROM tenant.crm_lost_reasons WHERE organization_id=$1 AND status='active'`, [organizationId])).rows.map((row) => [row.outcome_type, row.id]));
  const closePlan = [["Priya Nair", "won", 2], ["Karan Mehta", "won", 1], ["Atharva Chavan", "won", 1], ["Priya Nair", "lost", 1], ["Ananya Rao", "lost", 1]];
  for (const [name, outcome, target] of closePlan) {
    const have = Number((await admin.query(`SELECT count(*)::int n FROM tenant.crm_opportunities WHERE organization_id=$1 AND owner_user_id=$2 AND status=$3`, [organizationId, users[name], outcome])).rows[0].n);
    if (have >= target) { console.log(`Already present: ${name} has ${have} ${outcome}`); continue; }
    const candidates = (await admin.query(
      `SELECT id, updated_at, stage_id FROM tenant.crm_opportunities WHERE organization_id=$1 AND status='open' AND owner_user_id=$2 AND NOT (name = ANY($3::text[])) ORDER BY amount DESC NULLS LAST LIMIT 10`,
      [organizationId, users[name], PROTECTED],
    )).rows;
    let closed = 0;
    for (const row of candidates) {
      if (closed >= target - have) break;
      try {
        await withTx((c) => moveOpportunityStage(c, context, row.id, stages[outcome === "won" ? "Closed Won" : "Closed Lost"], null, {
          outcomeReasonId: reasons[outcome] ?? reasons.both,
          outcomeNotes: outcome === "won" ? "Demo: signed after final pricing review." : "Demo: budget was not approved this year.",
          expectedUpdatedAt: row.updated_at.toISOString(),
          expectedStageId: row.stage_id,
        }));
        closed += 1;
      } catch (error) {
        console.log(`  skipped one deal (${error.code || error.message})`);
      }
    }
    console.log(`Closed ${closed} deal(s) as ${outcome} for ${name}`);
  }
  console.log("Done.");
  await admin.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
