#!/usr/bin/env node
// F007 Lead Stages and Statuses — the demo org's 5-stage template and graph
// already existed, but with no dwell/SLA thresholds configured anywhere (so
// the dwell badge could never show anything but "ok"), no reason-required
// transition or reason vocabulary (so that half of the Pipeline tab/settings
// screen had nothing to demonstrate), no sales-team/manager hierarchy (so
// the manager-escalation gap-closure could never actually resolve a
// manager and had never been exercised end to end), and no retired stage
// (so the settings screen's "Retired"/reactivate state was unseen). Uses
// the app's own governed functions throughout (updateLeadStage,
// addLeadStageTransition, createLeadStageTransitionReason, createCrmRecord,
// assignLeadOwner, deactivateLeadStageWithMigration, and the real
// scanLeadStageDwellBreaches scan) — never raw SQL for operational
// records. Local-only, idempotent, same convention as the other
// scripts/qa/seed-*.mjs scripts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import {
  addLeadStageTransition,
  assignLeadOwner,
  createCrmRecord,
  createLeadStage,
  createLeadStageTransitionReason,
  deactivateLeadStageWithMigration,
  scanLeadStageDwellBreaches,
  updateLeadStage,
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
  const context = { organizationId, userId: owner.id, activeCompanyId: company?.id ?? null, allowAllCompanies: true, permissions: [], roleSlugs: ["organization_owner"] };

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

  console.log(`Seeding F007 Lead Stages and Statuses demo data for "${ORG_NAME}" (${organizationId})...`);

  const stages = Object.fromEntries((await admin.query(
    `SELECT code, id, dwell_warning_hours, dwell_breach_hours FROM tenant.crm_lead_stages WHERE organization_id=$1`,
    [organizationId],
  )).rows.map((row) => [row.code, row]));
  if (!stages.new || !stages.contacted || !stages.working || !stages.nurturing)
    throw new Error("Expected the standard 5-stage template to already exist for this org.");

  // --- 1. Dwell/SLA thresholds — deliberately different per stage so the
  // demo shows both a "warning" and a "breached" dwell badge, not just one.
  const dwellPlans = [
    { code: "new", warning: 12, breach: 24 },
    { code: "contacted", warning: 8, breach: 12 },
    { code: "working", warning: 6, breach: 10 },
  ];
  for (const plan of dwellPlans) {
    const stage = stages[plan.code];
    if (stage.dwell_warning_hours !== null || stage.dwell_breach_hours !== null) {
      console.log(`  dwell thresholds (already set): ${plan.code}`);
      continue;
    }
    await withTx((client) => updateLeadStage(client, context, stage.id, { dwellWarningHours: plan.warning, dwellBreachHours: plan.breach }));
    console.log(`  dwell thresholds set: ${plan.code} (warning ${plan.warning}h, breach ${plan.breach}h)`);
  }

  // --- 2. A reason-required transition — Working/Discovery -> Nurturing,
  // the one edge where "why is this deal pausing instead of closing" is a
  // genuinely governed business question.
  const existingTransitions = (await admin.query(
    `SELECT from_stage_id, to_stage_id, reason_required FROM tenant.crm_lead_stage_transitions WHERE organization_id=$1`,
    [organizationId],
  )).rows;
  const workingToNurturing = existingTransitions.find((row) => row.from_stage_id === stages.working.id && row.to_stage_id === stages.nurturing.id);
  if (workingToNurturing?.reason_required) {
    console.log("  reason-required transition (already set): working -> nurturing");
  } else {
    await withTx((client) => addLeadStageTransition(client, context, stages.working.id, stages.nurturing.id, { reasonRequired: true }));
    console.log("  reason-required transition set: working -> nurturing");
  }

  // --- 3. Transition reasons covering all three scope levels.
  const existingReasons = (await admin.query(
    `SELECT code FROM tenant.crm_lead_stage_transition_reasons WHERE organization_id=$1`,
    [organizationId],
  )).rows.map((row) => row.code);
  const reasonPlans = [
    { scopeType: "any", code: "reassigned_by_manager", label: "Reassigned by manager" },
    { scopeType: "destination", toStageId: stages.nurturing.id, code: "budget_deferred", label: "Budget deferred to next quarter" },
    { scopeType: "transition", fromStageId: stages.working.id, toStageId: stages.nurturing.id, code: "evaluation_paused", label: "Prospect requested to pause evaluation" },
  ];
  for (const plan of reasonPlans) {
    if (existingReasons.includes(plan.code)) {
      console.log(`  transition reason (already exists): ${plan.label}`);
      continue;
    }
    await withTx((client) => createLeadStageTransitionReason(client, context, plan));
    console.log(`  transition reason created: ${plan.label}`);
  }

  // --- 4. A sales team + manager, so the F007 dwell-breach scan's manager-
  // escalation gap-closure has a real manager to resolve and notify —
  // reuses the Priya Nair / Karan Mehta / Ananya Rao reps F005 already
  // seeded rather than inventing new demo users.
  const repIds = Object.fromEntries((await admin.query(
    `SELECT full_name, id FROM users WHERE email IN ('priya.nair@vercentlabs.demo','karan.mehta@vercentlabs.demo','ananya.rao@vercentlabs.demo')`,
  )).rows.map((row) => [row.full_name, row.id]));
  if (!repIds["Priya Nair"] || !repIds["Karan Mehta"] || !repIds["Ananya Rao"])
    throw new Error("Expected F005's demo sales reps (Priya Nair, Karan Mehta, Ananya Rao) to already exist.");

  let team = (await admin.query(
    `SELECT id FROM tenant.crm_sales_teams WHERE organization_id=$1 AND name=$2`,
    [organizationId, "Direct Sales Pod"],
  )).rows[0];
  if (!team) {
    team = await withTx((client) => createCrmRecord(client, context, "sales-teams", {
      companyId: company?.id ?? null,
      code: "DIRECT-POD",
      name: "Direct Sales Pod",
      managerUserId: repIds["Ananya Rao"],
      status: "active",
    }));
    console.log("  sales team created: Direct Sales Pod (manager: Ananya Rao)");
  } else {
    console.log("  sales team (already exists): Direct Sales Pod");
  }
  for (const memberName of ["Priya Nair", "Karan Mehta"]) {
    const existingMember = (await admin.query(
      `SELECT id FROM tenant.crm_sales_team_members WHERE organization_id=$1 AND team_id=$2 AND user_id=$3`,
      [organizationId, team.id, repIds[memberName]],
    )).rows[0];
    if (existingMember) {
      console.log(`  team member (already added): ${memberName}`);
      continue;
    }
    await withTx((client) => createCrmRecord(client, context, "sales-team-members", {
      companyId: company?.id ?? null,
      teamId: team.id,
      userId: repIds[memberName],
      memberRole: "seller",
      effectiveFrom: new Date().toISOString().slice(0, 10),
      status: "active",
    }));
    console.log(`  team member added: ${memberName} -> Direct Sales Pod`);
  }

  // --- 5. Assign a long-dwelling, currently-unowned "Working / Discovery"
  // Lead to Priya Nair (assignLeadOwner never touches stage_entered_at, so
  // its existing dwell breach is preserved), then run the real dwell scan
  // so the owner+manager escalation actually fires two real notifications.
  const staleWorkingLead = (await admin.query(
    `SELECT id, full_name FROM tenant.crm_leads WHERE organization_id=$1 AND status='working' AND owner_user_id IS NULL AND record_status='active' ORDER BY full_name LIMIT 1`,
    [organizationId],
  )).rows[0];
  if (staleWorkingLead) {
    await withTx((client) => assignLeadOwner(client, context, staleWorkingLead.id, repIds["Priya Nair"], { reason: "F007 dwell-breach escalation demo" }));
    console.log(`  lead assigned for escalation demo: ${staleWorkingLead.full_name} -> Priya Nair`);
  } else {
    console.log("  escalation demo lead (skipped): no unowned Lead left on Working / Discovery");
  }
  const scan = await withTx((client) => scanLeadStageDwellBreaches(client, context));
  console.log(`  dwell-breach scan run: ${scan.scanned} scanned, ${scan.notified} notified (owner + resolvable manager)`);

  // --- 6. A retired stage, so the settings screen's "Retired" badge and
  // reactivate action have something real to show — created then
  // immediately retired since it starts with zero active Leads, so
  // deactivation is trivial and needs no migration.
  let archivedStage = (await admin.query(
    `SELECT id, status FROM tenant.crm_lead_stages WHERE organization_id=$1 AND name=$2`,
    [organizationId, "Cold — Archived"],
  )).rows[0];
  if (!archivedStage) {
    archivedStage = await withTx((client) => createLeadStage(client, context, {
      name: "Cold — Archived",
      description: "Legacy stage kept for historical Leads only; no longer offered for new moves.",
      sortOrder: 900,
    }));
    console.log("  stage created: Cold — Archived");
  }
  if (archivedStage.status !== "inactive") {
    const result = await withTx((client) => deactivateLeadStageWithMigration(client, context, archivedStage.id, {}));
    console.log(result.deactivated ? "  stage retired: Cold — Archived" : "  stage retirement (unexpectedly blocked): Cold — Archived");
  } else {
    console.log("  stage (already retired): Cold — Archived");
  }

  console.log("Done.");
  await admin.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
