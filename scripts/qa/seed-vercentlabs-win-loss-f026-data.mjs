#!/usr/bin/env node
// F026 Won / lost reasons — the demo org had a two-entry reason catalog and
// every closed deal shared one of those two reasons, so the new "Won and lost
// reasons" report had nothing to compare and there was no reopen in history.
// Adds a realistic catalog through the governed generic create path, closes
// deals with varied reasons through moveOpportunityStage, and reopens one lost
// deal (with a reason) and wins it — so its detail shows lost → reopened →
// won, with the original loss preserved in the immutable history.
// Local-only, idempotent (guarded by codes, counts and existing history).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { createCrmRecord, moveOpportunityStage } from "../../services/api/src/index.js";
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
const PROTECTED = ["Suvidha Logistics Pvt Ltd — Custom Reporting Add-on", "Suvidha Logistics Pvt Ltd — Cold Chain Monitoring"];
const REOPEN_NOTE = "Customer's revised budget was approved; they asked us to resume.";

const CATALOG = [
  { code: "LOST_COMPETITOR", name: "Lost to competitor", category: "competition", outcomeType: "lost", sequence: 10 },
  { code: "LOST_PRICE", name: "Price too high", category: "price", outcomeType: "lost", sequence: 20 },
  { code: "LOST_TIMING", name: "Project postponed", category: "timing", outcomeType: "lost", sequence: 30 },
  { code: "LOST_NO_DECISION", name: "No decision / went silent", category: "no_response", outcomeType: "lost", sequence: 40 },
  { code: "WON_RELATIONSHIP", name: "Relationship and trust", category: "other", outcomeType: "won", sequence: 10 },
  { code: "WON_COMMERCIAL", name: "Commercial terms", category: "price", outcomeType: "won", sequence: 20 },
  { code: "WON_IMPLEMENTATION", name: "Implementation confidence", category: "fit", outcomeType: "won", sequence: 30 },
];

// [owner, outcome, reason code, how many, notes]
const CLOSES = [
  ["Priya Nair", "lost", "LOST_COMPETITOR", 2, "Chose a competitor's bundled offer with a lower first-year price."],
  ["Karan Mehta", "lost", "LOST_COMPETITOR", 1, "Incumbent vendor matched our scope at renewal."],
  ["Karan Mehta", "lost", "LOST_PRICE", 1, "Asked for 30% off; outside approved discount."],
  ["Ananya Rao", "lost", "LOST_TIMING", 1, "Rollout moved to next financial year."],
  ["Atharva Chavan", "lost", "LOST_NO_DECISION", 1, "No response after the final proposal and two follow-ups."],
  ["Priya Nair", "won", "WON_RELATIONSHIP", 1, "Long relationship with the plant head; references from their sister unit."],
  ["Karan Mehta", "won", "WON_IMPLEMENTATION", 1, "Pilot at the Nashik site convinced operations."],
  ["Ananya Rao", "won", "WON_COMMERCIAL", 1, "Three-year term with phased payments."],
];

async function main() {
  const admin = new Client({ connectionString });
  await admin.connect();
  const organizationId = (await admin.query(`SELECT id FROM organizations WHERE name=$1 LIMIT 1`, [ORG_NAME])).rows[0]?.id;
  if (!organizationId) throw new Error(`Organization "${ORG_NAME}" not found.`);
  const users = Object.fromEntries((await admin.query(
    `SELECT u.full_name, u.id FROM users u JOIN organization_memberships om ON om.user_id=u.id WHERE om.organization_id=$1 AND om.status='active'`,
    [organizationId],
  )).rows.map((row) => [row.full_name, row.id]));
  const contextFor = (name) => ({
    organizationId, userId: users[name], activeCompanyId: null, activeBranchId: null, allowAllCompanies: true,
    permissions: ["crm.records.view_all", "crm.settings.manage", "crm.opportunities.manage"], roleSlugs: name === "Atharva Chavan" ? ["organization_owner"] : [],
  });
  async function withTx(fn) {
    await admin.query("BEGIN");
    try { await setTenantContext(admin, organizationId); const r = await fn(admin); await admin.query("COMMIT"); return r; }
    catch (e) { await admin.query("ROLLBACK"); throw e; }
  }
  console.log("Seeding F026 won/lost reasons demo data...");

  // 1. Reason catalog.
  for (const reason of CATALOG) {
    const exists = (await admin.query(`SELECT 1 FROM tenant.crm_lost_reasons WHERE organization_id=$1 AND code=$2`, [organizationId, reason.code])).rows[0];
    if (exists) { console.log(`Already present: reason ${reason.name}`); continue; }
    await withTx((c) => createCrmRecord(c, contextFor("Atharva Chavan"), "lost-reasons", { ...reason, status: "active" }));
    console.log(`Created reason ${reason.name} (${reason.outcomeType})`);
  }
  const reasonIds = Object.fromEntries((await admin.query(`SELECT code, id FROM tenant.crm_lost_reasons WHERE organization_id=$1`, [organizationId])).rows.map((row) => [row.code, row.id]));
  const stages = Object.fromEntries((await admin.query(`SELECT name, id FROM tenant.crm_pipeline_stages WHERE organization_id=$1`, [organizationId])).rows.map((row) => [row.name, row.id]));

  // 2. Closes with varied reasons (the deals' Q4 forecast categories stay intact: only 'pipeline' deals are closed).
  for (const [name, outcome, code, target, notes] of CLOSES) {
    // Counted from the immutable history, so a deal later reopened (step 3) still counts.
    const have = Number((await admin.query(
      `SELECT count(DISTINCT history.opportunity_id)::int n FROM tenant.crm_opportunity_stage_history history
         JOIN tenant.crm_opportunities o ON o.id=history.opportunity_id AND o.organization_id=history.organization_id
        WHERE history.organization_id=$1 AND o.owner_user_id=$2 AND history.status=$3 AND history.outcome_reason_id=$4`,
      [organizationId, users[name], outcome, reasonIds[code]],
    )).rows[0].n);
    if (have >= target) { console.log(`Already present: ${name} ${outcome} × ${have} (${code})`); continue; }
    const candidates = (await admin.query(
      `SELECT id, updated_at, stage_id FROM tenant.crm_opportunities
        WHERE organization_id=$1 AND owner_user_id=$2 AND status='open' AND forecast_category='pipeline' AND NOT (name = ANY($3::text[]))
        ORDER BY code DESC LIMIT 6`,
      [organizationId, users[name], PROTECTED],
    )).rows;
    let closed = 0;
    for (const row of candidates) {
      if (closed >= target - have) break;
      try {
        await withTx((c) => moveOpportunityStage(c, contextFor(name), row.id, stages[outcome === "won" ? "Closed Won" : "Closed Lost"], null, {
          outcomeReasonId: reasonIds[code], outcomeNotes: notes, expectedUpdatedAt: row.updated_at.toISOString(), expectedStageId: row.stage_id,
        }));
        closed += 1;
      } catch (error) { console.log(`  skipped one deal (${error.code || error.message})`); }
    }
    console.log(`Closed ${closed} of ${name}'s deals as ${outcome} (${code})`);
  }

  // 3. Reopen one lost deal with a reason, then win it — history keeps the loss.
  const reopened = (await admin.query(`SELECT 1 FROM tenant.crm_opportunity_stage_history WHERE organization_id=$1 AND note=$2`, [organizationId, REOPEN_NOTE])).rows[0];
  if (reopened) console.log("Already present: reopened-then-won deal");
  else {
    const lost = (await admin.query(
      `SELECT o.id, o.updated_at, o.stage_id, u.full_name FROM tenant.crm_opportunities o JOIN users u ON u.id=o.owner_user_id
        WHERE o.organization_id=$1 AND o.status='lost' AND o.outcome_reason_id=$2 AND NOT (o.name = ANY($3::text[])) ORDER BY o.amount DESC LIMIT 1`,
      [organizationId, reasonIds.LOST_TIMING, PROTECTED],
    )).rows[0];
    if (!lost) console.log("No lost deal to reopen (run again after step 2).");
    else {
      const open = await withTx((c) => moveOpportunityStage(c, contextFor(lost.full_name), lost.id, stages.Negotiation, REOPEN_NOTE, {
        expectedUpdatedAt: lost.updated_at.toISOString(), expectedStageId: lost.stage_id,
      }));
      await withTx((c) => moveOpportunityStage(c, contextFor(lost.full_name), lost.id, stages["Closed Won"], null, {
        outcomeReasonId: reasonIds.WON_COMMERCIAL, outcomeNotes: "Signed after the revised budget; phased payments agreed.",
        expectedUpdatedAt: new Date(open.updatedAt).toISOString(), expectedStageId: stages.Negotiation,
      }));
      console.log(`Reopened and won ${lost.full_name}'s previously lost deal`);
    }
  }
  console.log("Done.");
  await admin.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
