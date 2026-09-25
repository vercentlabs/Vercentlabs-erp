#!/usr/bin/env node
// F011 Probability and Expected Revenue — the demo org already has real
// probability-history rows for 4 of 6 governed sources (terminal_won,
// terminal_lost, stage_default, manual_override — the last written this
// session's own live verification, with a slightly rough note), but zero
// rows for 'reopen' or 'restored', and zero predictive-forecast snapshots
// (so the per-Opportunity "Model suggests N%" suggestion has nothing to
// read). This seeds exactly what's missing, entirely through governed
// functions (createCrmRecord, updateOpportunityProbability,
// moveOpportunityStage, archiveCrmRecord, restoreOpportunity,
// capturePredictiveForecast) — never a raw history INSERT, since the table
// is immutable and only ever written by those functions in the first place.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import {
  archiveCrmRecord,
  capturePredictiveForecast,
  createCrmRecord,
  moveOpportunityStage,
  restoreOpportunity,
  updateOpportunityProbability,
} from "../../services/api/src/index.js";
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

  console.log(`Seeding F011 Probability demo data for "${ORG_NAME}" (${organizationId})...`);

  const account = (await admin.query(
    `SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND status='active' ORDER BY created_at LIMIT 1`,
    [organizationId],
  )).rows[0];
  const lostReason = (await admin.query(
    `SELECT id FROM tenant.crm_lost_reasons WHERE organization_id=$1 AND name=$2`,
    [organizationId, "Budget not approved"],
  )).rows[0];
  if (!lostReason) throw new Error('Expected the F009 seed\'s "Budget not approved" lost reason to already exist — run seed-vercentlabs-opportunities-f009-data.mjs first.');

  // --- 1. 'reopen' provenance — create, lose, then reopen with a reason.
  const reopenName = "Suvidha Logistics Pvt Ltd — Billing Automation";
  let reopenDeal = (await admin.query(`SELECT id, status, stage_id, pipeline_id, updated_at FROM tenant.crm_opportunities WHERE organization_id=$1 AND name=$2`, [organizationId, reopenName])).rows[0];
  if (!reopenDeal) {
    const created = await withTx((client) => createCrmRecord(client, context, "opportunities", {
      name: reopenName,
      partyId: account?.id ?? null,
      amount: 180000,
      currencyCode: "INR",
      nextStep: "Re-engage after reopening",
      expectedCloseDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    }));
    reopenDeal = { id: created.id, status: created.status, stage_id: created.stageId, pipeline_id: created.pipelineId, updated_at: created.updatedAt };
    console.log(`  opportunity created: ${reopenName}`);
  } else {
    console.log(`  opportunity (already exists): ${reopenName}`);
  }
  // Idempotency guard: after a full run this deal's status is 'open' again
  // — indistinguishable from "never touched" by status alone — so gate the
  // lose-then-reopen dance on whether a 'reopen' history row already
  // exists, not on current status (which would otherwise re-lose and
  // re-reopen it, and pile up duplicate history, on every re-run).
  const alreadyReopened = (await admin.query(
    `SELECT 1 FROM tenant.crm_opportunity_probability_history WHERE organization_id=$1 AND opportunity_id=$2 AND source='reopen'`,
    [organizationId, reopenDeal.id],
  )).rows[0];
  if (!alreadyReopened && reopenDeal.status === "open") {
    const lostStage = (await admin.query(
      `SELECT id FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND pipeline_id=$2 AND is_lost=true AND status='active' LIMIT 1`,
      [organizationId, reopenDeal.pipeline_id],
    )).rows[0];
    const moved = await withTx((client) => moveOpportunityStage(client, context, reopenDeal.id, lostStage.id, "Prospect went quiet.", {
      expectedUpdatedAt: reopenDeal.updated_at,
      expectedStageId: reopenDeal.stage_id,
      outcomeReasonId: lostReason.id,
      outcomeNotes: "Budget frozen for the quarter.",
    }));
    reopenDeal = { id: reopenDeal.id, status: moved.status, stage_id: moved.stageId, pipeline_id: reopenDeal.pipeline_id, updated_at: moved.updatedAt };
    console.log(`  moved to Lost: ${reopenName}`);
  }
  if (!alreadyReopened && reopenDeal.status === "lost") {
    const qualificationStage = (await admin.query(
      `SELECT id FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND pipeline_id=$2 AND is_won=false AND is_lost=false AND status='active' ORDER BY sequence LIMIT 1`,
      [organizationId, reopenDeal.pipeline_id],
    )).rows[0];
    await withTx((client) => moveOpportunityStage(client, context, reopenDeal.id, qualificationStage.id, "Budget approved for next quarter — re-engaging.", {
      expectedUpdatedAt: reopenDeal.updated_at,
      expectedStageId: reopenDeal.stage_id,
    }));
    console.log(`  reopened: ${reopenName}`);
  } else {
    console.log(`  already reopened: ${reopenName}`);
  }

  // --- 2. 'restored' provenance — create, manually override (bonus clean
  // manual_override example), archive, then restore. restoreOpportunity
  // only writes a history row when probability actually changes, so the
  // manual override beforehand (to a value the stage's own default won't
  // match on restore) is what makes the 'restored' row real, not skipped.
  const restoredName = "Suvidha Logistics Pvt Ltd — Customer Portal";
  let restoredDeal = (await admin.query(`SELECT id, status, probability, updated_at FROM tenant.crm_opportunities WHERE organization_id=$1 AND name=$2`, [organizationId, restoredName])).rows[0];
  if (!restoredDeal) {
    const created = await withTx((client) => createCrmRecord(client, context, "opportunities", {
      name: restoredName,
      partyId: account?.id ?? null,
      amount: 95000,
      currencyCode: "INR",
      nextStep: "Confirm renewed interest",
    }));
    restoredDeal = { id: created.id, status: created.status, probability: created.probability, updated_at: created.updatedAt };
    console.log(`  opportunity created: ${restoredName}`);
  } else {
    console.log(`  opportunity (already exists): ${restoredName}`);
  }
  // Idempotency guard: after a full run this deal's status is 'open' again
  // (restoreOpportunity's whole point) — indistinguishable from "never
  // touched" by status alone. Gate the override-archive-restore dance on
  // whether a 'restored' history row already exists, or a re-run would
  // override/archive/restore it again every single time.
  const alreadyRestored = (await admin.query(
    `SELECT 1 FROM tenant.crm_opportunity_probability_history WHERE organization_id=$1 AND opportunity_id=$2 AND source='restored'`,
    [organizationId, restoredDeal.id],
  )).rows[0];
  if (!alreadyRestored && restoredDeal.status === "open" && Number(restoredDeal.probability) !== 45) {
    const overridden = await withTx((client) => updateOpportunityProbability(client, context, restoredDeal.id, 45, "Strong initial interest from a warm intro.", {
      expectedUpdatedAt: restoredDeal.updated_at,
      expectedProbability: Number(restoredDeal.probability),
    }));
    restoredDeal = { id: restoredDeal.id, status: overridden.status, probability: overridden.probability, updated_at: overridden.updatedAt };
    console.log(`  manually overridden to 45%: ${restoredName}`);
  }
  if (!alreadyRestored && restoredDeal.status === "open") {
    // No expectations passed — matches seed-vercentlabs-opportunities-f009-
    // data.mjs's own convention; skips the optional version check entirely
    // rather than chasing Date-serialization precision across the prior
    // governed call's return value.
    const archived = await withTx((client) => archiveCrmRecord(client, context, "opportunities", restoredDeal.id));
    restoredDeal = { id: restoredDeal.id, status: archived.status, probability: archived.probability, updated_at: archived.updatedAt };
    console.log(`  archived: ${restoredName}`);
  }
  if (!alreadyRestored && restoredDeal.status === "archived") {
    await withTx((client) => restoreOpportunity(client, context, restoredDeal.id, "Prospect re-engaged after six months quiet."));
    console.log(`  restored: ${restoredName}`);
  } else {
    console.log(`  already restored: ${restoredName}`);
  }

  // --- 3. A clean, single-entry "manually set" demo — the existing manual_
  // override example on F009's real demo data is a leftover live-
  // verification note, truthful but not a clean screenshot; this is a
  // one-shot, nothing-else-touched example of the "Manually set" badge.
  const manualName = "Suvidha Logistics Pvt Ltd — Cold Chain Monitoring";
  let manualDeal = (await admin.query(`SELECT id, status, probability, updated_at FROM tenant.crm_opportunities WHERE organization_id=$1 AND name=$2`, [organizationId, manualName])).rows[0];
  if (!manualDeal) {
    const created = await withTx((client) => createCrmRecord(client, context, "opportunities", {
      name: manualName,
      partyId: account?.id ?? null,
      amount: 220000,
      currencyCode: "INR",
      nextStep: "Send updated proposal",
    }));
    manualDeal = { id: created.id, status: created.status, probability: created.probability, updated_at: created.updatedAt };
    console.log(`  opportunity created: ${manualName}`);
  } else {
    console.log(`  opportunity (already exists): ${manualName}`);
  }
  if (Number(manualDeal.probability) !== 60) {
    await withTx((client) => updateOpportunityProbability(client, context, manualDeal.id, 60, "Champion confirmed budget is approved for this quarter.", {
      expectedUpdatedAt: manualDeal.updated_at,
      expectedProbability: Number(manualDeal.probability),
    }));
    console.log(`  manually overridden to 60%: ${manualName}`);
  } else {
    console.log(`  already overridden: ${manualName}`);
  }

  // --- 4. A predictive-forecast snapshot, so every currently-open
  // Opportunity (including both demo deals above) has a real per-
  // Opportunity predicted probability the Pipeline tab can read back.
  const snapshotCount = (await admin.query(`SELECT count(*)::int AS n FROM tenant.crm_predictive_forecast_snapshots WHERE organization_id=$1`, [organizationId])).rows[0].n;
  if (snapshotCount === 0) {
    const { forecast } = await withTx((client) => capturePredictiveForecast(client, context, {}));
    console.log(`  predictive-forecast snapshot captured: ${forecast.opportunityCount} open deals, ${forecast.confidence}% confidence`);
  } else {
    console.log(`  predictive-forecast snapshot (already exists): ${snapshotCount} snapshot(s)`);
  }

  console.log("Done.");
  await admin.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
