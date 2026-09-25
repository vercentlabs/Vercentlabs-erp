#!/usr/bin/env node
// F009 Opportunities — the demo org already has 140+ real open Opportunities
// with a healthy mix of amounts/stages/owners and 19 real multi-contact-role
// rows, but three genuine gaps meant several F009 screens had nothing real
// to show: zero rows in tenant.crm_lost_reasons at all (so an Opportunity
// could never actually be moved to Won or Lost — moveOpportunityStage
// requires a real outcome reason), zero Won/Lost/overdue/archived
// Opportunities to demonstrate those states, and (after this session's own
// interactive Playwright verification) the one Archived Opportunity that
// existed was a leftover test artifact, already restored back to its real
// prior state rather than left behind. Uses the app's own governed
// functions throughout (createCrmRecord, moveOpportunityStage,
// archiveCrmRecord) — never raw SQL for operational records. Local-only,
// idempotent, same convention as the other scripts/qa/seed-*.mjs scripts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import {
  createCrmRecord,
  moveOpportunityStage,
  archiveCrmRecord,
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

  console.log(`Seeding F009 Opportunities demo data for "${ORG_NAME}" (${organizationId})...`);

  // --- 1. Won/Lost outcome reasons — zero existed for this org (F026's
  // migration-time default seed only ever ran for orgs that existed when
  // that migration shipped), so moveOpportunityStage could never actually
  // close an Opportunity: it hard-requires a real outcomeReasonId.
  const wonReason = (await admin.query(
    `SELECT id FROM tenant.crm_lost_reasons WHERE organization_id=$1 AND name=$2`,
    [organizationId, "Strong product fit"],
  )).rows[0];
  let wonReasonId = wonReason?.id;
  if (!wonReason) {
    const created = await withTx((client) => createCrmRecord(client, context, "lost-reasons", {
      name: "Strong product fit",
      code: "F009_WON_FIT",
      category: "fit",
      outcomeType: "won",
    }));
    wonReasonId = created.id;
    console.log("  won reason created: Strong product fit");
  } else {
    console.log("  won reason (already exists): Strong product fit");
  }
  const lostReason = (await admin.query(
    `SELECT id FROM tenant.crm_lost_reasons WHERE organization_id=$1 AND name=$2`,
    [organizationId, "Budget not approved"],
  )).rows[0];
  let lostReasonId = lostReason?.id;
  if (!lostReason) {
    const created = await withTx((client) => createCrmRecord(client, context, "lost-reasons", {
      name: "Budget not approved",
      code: "F009_LOST_BUDGET",
      category: "price",
      outcomeType: "lost",
    }));
    lostReasonId = created.id;
    console.log("  lost reason created: Budget not approved");
  } else {
    console.log("  lost reason (already exists): Budget not approved");
  }

  // A real Account/Contact to link the demo deals to, reused rather than
  // creating new master data just for this feature's own screenshots.
  const account = (await admin.query(
    `SELECT id FROM tenant.business_parties WHERE organization_id=$1 AND status='active' ORDER BY created_at LIMIT 1`,
    [organizationId],
  )).rows[0];
  const contact = (await admin.query(
    `SELECT id FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2 AND status='active' LIMIT 1`,
    [organizationId, account.id],
  )).rows[0];

  const wonStage = (await admin.query(
    `SELECT id FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND is_won=true AND status='active' LIMIT 1`,
    [organizationId],
  )).rows[0];
  const lostStage = (await admin.query(
    `SELECT id FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND is_lost=true AND status='active' LIMIT 1`,
    [organizationId],
  )).rows[0];
  if (!wonStage || !lostStage) throw new Error("Expected the default pipeline to already have an active Won and Lost stage.");

  // --- 2. A Won deal, so the Won status badge and actual-close-date field
  // have something real to show.
  const wonDeal = (await admin.query(`SELECT id, status FROM tenant.crm_opportunities WHERE organization_id=$1 AND name=$2`, [organizationId, "Suvidha Logistics Pvt Ltd — Support Renewal FY26"])).rows[0];
  if (!wonDeal) {
    const created = await withTx((client) => createCrmRecord(client, context, "opportunities", {
      name: "Suvidha Logistics Pvt Ltd — Support Renewal FY26",
      partyId: account.id,
      contactId: contact?.id ?? null,
      amount: 850000,
      currencyCode: "INR",
      nextStep: "Countersign the renewal order form",
      expectedCloseDate: new Date().toISOString().slice(0, 10),
    }));
    await withTx((client) => moveOpportunityStage(client, context, created.id, wonStage.id, "Client confirmed renewal at the quoted terms.", {
      expectedUpdatedAt: created.updatedAt,
      expectedStageId: created.stageId,
      outcomeReasonId: wonReasonId,
      outcomeNotes: "Renewed at the same annual value; champion pushed it through procurement early.",
    }));
    console.log("  opportunity created and marked Won: Suvidha Logistics Pvt Ltd — Support Renewal FY26");
  } else if (wonDeal.status !== "won") {
    console.log("  opportunity exists but is not Won — leaving as-is (likely already moved manually):", wonDeal.status);
  } else {
    console.log("  opportunity (already Won): Suvidha Logistics Pvt Ltd — Support Renewal FY26");
  }

  // --- 3. A Lost deal, so the Lost status badge and Loss notes field have
  // something real to show.
  const lostDeal = (await admin.query(`SELECT id, status FROM tenant.crm_opportunities WHERE organization_id=$1 AND name=$2`, [organizationId, "Suvidha Logistics Pvt Ltd — Fleet Analytics Evaluation"])).rows[0];
  if (!lostDeal) {
    const created = await withTx((client) => createCrmRecord(client, context, "opportunities", {
      name: "Suvidha Logistics Pvt Ltd — Fleet Analytics Evaluation",
      partyId: account.id,
      amount: 420000,
      currencyCode: "INR",
      nextStep: "None — evaluation concluded",
      expectedCloseDate: new Date().toISOString().slice(0, 10),
    }));
    await withTx((client) => moveOpportunityStage(client, context, created.id, lostStage.id, "Prospect chose to delay the purchase to next fiscal year.", {
      expectedUpdatedAt: created.updatedAt,
      expectedStageId: created.stageId,
      outcomeReasonId: lostReasonId,
      outcomeNotes: "Finance froze new software spend for the rest of the quarter; revisit next cycle.",
    }));
    console.log("  opportunity created and marked Lost: Suvidha Logistics Pvt Ltd — Fleet Analytics Evaluation");
  } else if (lostDeal.status !== "lost") {
    console.log("  opportunity exists but is not Lost — leaving as-is:", lostDeal.status);
  } else {
    console.log("  opportunity (already Lost): Suvidha Logistics Pvt Ltd — Fleet Analytics Evaluation");
  }

  // --- 4. An overdue open deal, so the Overview tab's "Expected close date
  // passed" warning banner has something real to show.
  const overdueDeal = (await admin.query(`SELECT id FROM tenant.crm_opportunities WHERE organization_id=$1 AND name=$2`, [organizationId, "Suvidha Logistics Pvt Ltd — Contract Renewal 2026"])).rows[0];
  if (!overdueDeal) {
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    await withTx((client) => createCrmRecord(client, context, "opportunities", {
      name: "Suvidha Logistics Pvt Ltd — Contract Renewal 2026",
      partyId: account.id,
      amount: 260000,
      currencyCode: "INR",
      nextStep: "Follow up — this should have closed already",
      expectedCloseDate: tenDaysAgo,
    }));
    console.log("  opportunity created (overdue): Suvidha Logistics Pvt Ltd — Contract Renewal 2026");
  } else {
    console.log("  opportunity (already exists): Suvidha Logistics Pvt Ltd — Contract Renewal 2026");
  }

  // --- 5. An Archived deal, so the detail page's "Restore opportunity"
  // action and locked/read-only state have something real to show — left
  // archived deliberately (not restored) so this screen state persists.
  const archivedDeal = (await admin.query(`SELECT id, status FROM tenant.crm_opportunities WHERE organization_id=$1 AND name=$2`, [organizationId, "Suvidha Logistics Pvt Ltd — Warehouse Scanner Pilot"])).rows[0];
  if (!archivedDeal) {
    const created = await withTx((client) => createCrmRecord(client, context, "opportunities", {
      name: "Suvidha Logistics Pvt Ltd — Warehouse Scanner Pilot",
      partyId: account.id,
      amount: 95000,
      currencyCode: "INR",
      nextStep: "None — shelved",
    }));
    await withTx((client) => archiveCrmRecord(client, context, "opportunities", created.id));
    console.log("  opportunity created and archived: Suvidha Logistics Pvt Ltd — Warehouse Scanner Pilot");
  } else if (archivedDeal.status !== "archived") {
    await withTx((client) => archiveCrmRecord(client, context, "opportunities", archivedDeal.id));
    console.log("  opportunity re-archived: Suvidha Logistics Pvt Ltd — Warehouse Scanner Pilot");
  } else {
    console.log("  opportunity (already archived): Suvidha Logistics Pvt Ltd — Warehouse Scanner Pilot");
  }

  console.log("Done.");
  await admin.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
