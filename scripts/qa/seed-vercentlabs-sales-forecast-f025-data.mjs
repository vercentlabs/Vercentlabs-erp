#!/usr/bin/env node
// F025 Sales forecast — the demo org had no forecast periods or submissions,
// and every open deal sat in the "pipeline" category, so the Best case and
// Commit columns (and the rep's "From your deals in this period" panel) were
// all zero. Advances a few deals per rep to Proposal (best case) and
// Negotiation (committed) through the governed moveOpportunityStage path,
// creates a September 2026 month and a Q4 2026 quarter, and records rep
// submissions in each review state (submitted, approved with a manager
// adjustment, draft) through the governed generic create/update path.
// Local-only, idempotent (guarded by counts and existing state).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { createCrmRecord, moveOpportunityStage, updateCrmRecord } from "../../services/api/src/index.js";
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
    permissions: ["crm.records.view_all", "crm.settings.manage", "crm.opportunities.manage", "crm.forecast.manage"], roleSlugs: name === "Atharva Chavan" ? ["organization_owner"] : [],
  });
  async function withTx(fn) {
    await admin.query("BEGIN");
    try { await setTenantContext(admin, organizationId); const r = await fn(admin); await admin.query("COMMIT"); return r; }
    catch (e) { await admin.query("ROLLBACK"); throw e; }
  }
  console.log("Seeding F025 sales forecast demo data...");

  // 1. Advance some Q4 deals so Best case and Commit carry real amounts.
  const stages = Object.fromEntries((await admin.query(`SELECT name, id FROM tenant.crm_pipeline_stages WHERE organization_id=$1`, [organizationId])).rows.map((row) => [row.name, row.id]));
  const advancePlan = [["Priya Nair", 4, 3], ["Karan Mehta", 3, 2], ["Ananya Rao", 2, 1], ["Atharva Chavan", 3, 2]];
  for (const [name, bestCaseTarget, committedTarget] of advancePlan) {
    for (const [category, stageName, target] of [["committed", "Negotiation", committedTarget], ["best_case", "Proposal", bestCaseTarget]]) {
      const have = Number((await admin.query(
        `SELECT count(*)::int n FROM tenant.crm_opportunities WHERE organization_id=$1 AND owner_user_id=$2 AND status='open' AND forecast_category=$3 AND expected_close_date BETWEEN '2026-10-01' AND '2026-12-31'`,
        [organizationId, users[name], category],
      )).rows[0].n);
      if (have >= target) { console.log(`Already present: ${name} has ${have} ${category} deals in Q4`); continue; }
      const candidates = (await admin.query(
        `SELECT id, updated_at, stage_id FROM tenant.crm_opportunities
          WHERE organization_id=$1 AND owner_user_id=$2 AND status='open' AND forecast_category='pipeline'
            AND expected_close_date BETWEEN '2026-10-01' AND '2026-12-31' AND NOT (name = ANY($3::text[]))
          ORDER BY expected_close_date, code LIMIT $4`,
        [organizationId, users[name], PROTECTED, target - have],
      )).rows;
      let moved = 0;
      for (const row of candidates) {
        try {
          await withTx((c) => moveOpportunityStage(c, contextFor(name), row.id, stages[stageName], null, {
            expectedUpdatedAt: row.updated_at.toISOString(), expectedStageId: row.stage_id,
          }));
          moved += 1;
        } catch (error) { console.log(`  skipped one deal (${error.code || error.message})`); }
      }
      console.log(`Moved ${moved} of ${name}'s Q4 deals to ${stageName} (${category})`);
    }
  }

  // 2. Forecast periods.
  const periods = {};
  for (const period of [
    { name: "September 2026", periodType: "month", periodStart: "2026-09-01", periodEnd: "2026-09-30", currencyCode: "INR", status: "open" },
    { name: "Q4 2026 (Oct–Dec)", periodType: "quarter", periodStart: "2026-10-01", periodEnd: "2026-12-31", currencyCode: "INR", status: "open" },
  ]) {
    const existing = (await admin.query(`SELECT id FROM tenant.crm_forecast_periods WHERE organization_id=$1 AND period_start=$2 AND period_end=$3`, [organizationId, period.periodStart, period.periodEnd])).rows[0];
    if (existing) { periods[period.periodType] = existing.id; console.log(`Already present: period ${period.name}`); continue; }
    const created = await withTx((c) => createCrmRecord(c, contextFor("Atharva Chavan"), "forecast-periods", period));
    periods[period.periodType] = created.id;
    console.log(`Created period ${period.name}`);
  }

  // 3. Submissions, computed from each rep's own Q4 deals then judged.
  async function systemNumbers(userId) {
    return (await admin.query(
      `SELECT COALESCE(sum(amount) FILTER (WHERE status='open'),0)::numeric pipeline,
              COALESCE(sum(amount) FILTER (WHERE status='open' AND forecast_category='best_case'),0)::numeric best_case,
              COALESCE(sum(amount) FILTER (WHERE status='open' AND forecast_category='committed'),0)::numeric committed
         FROM tenant.crm_opportunities WHERE organization_id=$1 AND owner_user_id=$2 AND expected_close_date BETWEEN '2026-10-01' AND '2026-12-31'`,
      [organizationId, userId],
    )).rows[0];
  }
  const submissionPlan = [
    { name: "Priya Nair", status: "submitted", commitUplift: 1.0, confidence: 80, notes: "Sunrise Dairy and two Pune renewals are in Negotiation; confident on commit." },
    { name: "Karan Mehta", status: "submitted", commitUplift: 1.15, confidence: 65, notes: "Calling a little above committed deals — expecting the Nashik expansion to move to Negotiation next week.", review: { status: "approved", managerAdjustment: -450000 } },
    { name: "Ananya Rao", status: "draft", commitUplift: 1.0, confidence: 55, notes: "Draft — still checking two late-stage deals." },
  ];
  for (const plan of submissionPlan) {
    const ownerUserId = users[plan.name];
    let existing = (await admin.query(`SELECT id, status, updated_at FROM tenant.crm_forecast_submissions WHERE organization_id=$1 AND period_id=$2 AND owner_user_id=$3`, [organizationId, periods.quarter, ownerUserId])).rows[0];
    if (!existing) {
      const numbers = await systemNumbers(ownerUserId);
      const created = await withTx((c) => createCrmRecord(c, contextFor(plan.name), "forecast-submissions", {
        periodId: periods.quarter, ownerUserId, currencyCode: "INR",
        pipelineAmount: Number(numbers.pipeline), bestCaseAmount: Number(numbers.best_case),
        commitAmount: Math.round(Number(numbers.committed) * plan.commitUplift),
        confidencePercent: plan.confidence, notes: plan.notes, status: "draft",
      }));
      console.log(`Created ${plan.name}'s Q4 draft`);
      existing = { id: created.id, status: "draft", updated_at: new Date(created.updatedAt) };
    } else console.log(`Already present: ${plan.name}'s Q4 submission (${existing.status})`);
    if (plan.status === "submitted" && existing.status === "draft") {
      const updated = await withTx((c) => updateCrmRecord(c, contextFor(plan.name), "forecast-submissions", existing.id, { status: "submitted" }, { expectedUpdatedAt: existing.updated_at.toISOString() }));
      existing = { id: existing.id, status: "submitted", updated_at: new Date(updated.updatedAt) };
      console.log(`  ${plan.name} submitted`);
    }
    if (plan.review && existing.status === "submitted") {
      await withTx((c) => updateCrmRecord(c, contextFor("Atharva Chavan"), "forecast-submissions", existing.id, plan.review, { expectedUpdatedAt: existing.updated_at.toISOString() }));
      console.log(`  Atharva Chavan ${plan.review.status} ${plan.name}'s forecast (adjustment ${plan.review.managerAdjustment})`);
    }
  }
  console.log("Done.");
  await admin.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
