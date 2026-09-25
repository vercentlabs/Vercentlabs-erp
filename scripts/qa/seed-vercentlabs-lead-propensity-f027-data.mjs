#!/usr/bin/env node
// F027 Basic lead scoring — the demo org had an active rule model and a
// trained predictive model sitting in draft (activating it used to replace
// every rule score). With the rule score and ML propensity now separate,
// retrains the predictive model on current qualified/unqualified history and
// activates it ALONGSIDE the rule model through the governed config path,
// then drains the resulting recalculation job so every lead shows both its
// points score and its separate likelihood to qualify.
// Local-only, idempotent (skips when already active and fully recalculated).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { activateLeadScoringModel, processLeadScoreRecalcBatch, trainLeadScoringModel } from "../../services/api/src/index.js";
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
  const owner = (await admin.query(
    `SELECT u.id FROM users u JOIN organization_memberships om ON om.user_id=u.id WHERE om.organization_id=$1 AND u.full_name='Atharva Chavan'`,
    [organizationId],
  )).rows[0].id;
  const context = {
    organizationId, userId: owner, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true,
    permissions: ["crm.records.view_all", "crm.settings.manage", "crm.leads.view_sensitive"], roleSlugs: ["organization_owner"],
  };
  async function withTx(fn) {
    await admin.query("BEGIN");
    try { await setTenantContext(admin, organizationId); const r = await fn(admin); await admin.query("COMMIT"); return r; }
    catch (e) { await admin.query("ROLLBACK"); throw e; }
  }
  console.log("Seeding F027 lead propensity demo data...");

  const model = (await admin.query(
    `SELECT id, name, status FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND model_type='predictive' ORDER BY (status='active') DESC, version DESC LIMIT 1`,
    [organizationId],
  )).rows[0];
  if (!model) throw new Error("No predictive model found — create one in Settings > Lead scoring first.");
  const ruleActive = (await admin.query(`SELECT name FROM tenant.crm_lead_scoring_models WHERE organization_id=$1 AND model_type='rule_based' AND status='active'`, [organizationId])).rows[0];
  console.log(`Rule model active: ${ruleActive?.name ?? "none"}`);

  if (model.status !== "active") {
    await withTx((c) => trainLeadScoringModel(c, context, model.id));
    console.log(`Retrained "${model.name}" on current qualified/unqualified leads`);
    await withTx((c) => activateLeadScoringModel(c, context, model.id));
    console.log(`Activated "${model.name}" alongside the rule model`);
  } else console.log(`Already present: "${model.name}" active`);

  const jobs = (await admin.query(
    `SELECT DISTINCT job_id FROM tenant.crm_lead_score_recalc_items WHERE organization_id=$1 AND status='pending'`,
    [organizationId],
  )).rows.map((row) => row.job_id);
  for (const jobId of jobs) {
    let rounds = 0;
    for (;;) {
      const pending = Number((await admin.query(`SELECT count(*)::int n FROM tenant.crm_lead_score_recalc_items WHERE organization_id=$1 AND job_id=$2 AND status='pending'`, [organizationId, jobId])).rows[0].n);
      if (!pending || rounds > 200) break;
      await withTx((c) => processLeadScoreRecalcBatch(c, context, jobId));
      rounds += 1;
    }
    console.log(`Recalculated job ${jobId.slice(0, 8)} in ${rounds} batch(es)`);
  }
  if (!jobs.length) console.log("Already present: no pending recalculation");
  const summary = (await admin.query(
    `SELECT count(*) FILTER (WHERE propensity_score IS NOT NULL)::int with_propensity, count(*) FILTER (WHERE score_model_id IS NOT NULL)::int with_score, count(*)::int total FROM tenant.crm_leads WHERE organization_id=$1`,
    [organizationId],
  )).rows[0];
  console.log(`Leads: ${summary.total}; with rule score: ${summary.with_score}; with propensity: ${summary.with_propensity}`);
  console.log("Done.");
  await admin.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
