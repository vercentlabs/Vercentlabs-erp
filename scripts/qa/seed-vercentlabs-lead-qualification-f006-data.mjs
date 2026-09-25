#!/usr/bin/env node
// F006 Lead Qualification — the demo org already has a healthy mix of
// qualified/unqualified/not_reviewed leads and 287 qualification events
// from earlier demo seeding, but two real gaps in the demo data: zero
// Playbooks (an empty-state-only screenshot), and zero qualification
// events with override_used=true — meaning the governed exception-override
// path (decideLeadQualification's canOverrideQualification branch) had
// never actually been exercised with a real event to show in a Lead's
// history timeline. Uses the app's own governed functions throughout
// (createCrmRecord for the playbook, decideLeadQualification for the
// override), never raw SQL for operational records. Local-only,
// idempotent, same convention as the other scripts/qa/seed-*.mjs scripts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { createCrmRecord, decideLeadQualification } from "../../services/api/src/index.js";
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

  console.log(`Seeding F006 Lead Qualification demo data for "${ORG_NAME}" (${organizationId})...`);

  // --- 1. A playbook, so the settings screen's second section isn't an
  // empty state.
  const existingPlaybook = (await admin.query(
    `SELECT id FROM tenant.crm_playbooks WHERE organization_id=$1 AND name=$2`,
    [organizationId, "MEDDIC Discovery Playbook"],
  )).rows[0];
  if (!existingPlaybook) {
    await withTx((client) => createCrmRecord(client, context, "playbooks", {
      companyId: company?.id ?? null,
      name: "MEDDIC Discovery Playbook",
      framework: "meddic",
      description: "Discovery-call checklist for enterprise Leads: confirm Metrics, Economic buyer, Decision criteria, Decision process, Identify pain, and Champion before qualifying.",
      status: "active",
    }));
    console.log("  playbook created: MEDDIC Discovery Playbook");
  } else {
    console.log("  playbook (already exists): MEDDIC Discovery Playbook");
  }

  // --- 2. A real override event, so a Lead's qualification history shows
  // what the governed exception path actually looks like (F006's
  // canOverrideQualification branch, exercised for real rather than left
  // as untested backend logic).
  const hasOverrideEvent = (await admin.query(
    `SELECT 1 FROM tenant.crm_lead_qualification_events WHERE organization_id=$1 AND override_used=true LIMIT 1`,
    [organizationId],
  )).rows[0];
  if (!hasOverrideEvent) {
    const candidate = (await admin.query(
      `SELECT id, full_name, score FROM tenant.crm_leads
        WHERE organization_id=$1 AND record_status='active' AND qualification_state='not_reviewed' AND score < 60
        ORDER BY score DESC, full_name LIMIT 1`,
      [organizationId],
    )).rows[0];
    if (!candidate) {
      console.log("  override event (skipped): no not_reviewed Lead with score < 60 found");
    } else {
      await withTx((client) => decideLeadQualification(client, context, candidate.id, {
        decision: "qualified",
        note: "Strong champion and mid-decision-cycle timeline; qualifying ahead of score threshold pending next scoring pass.",
        overrideUsed: true,
        overrideReason: "Field sales lead confirmed active budget and named economic buyer on discovery call; predictive score has not yet caught up to this week's activity.",
      }));
      console.log(`  override event created: ${candidate.full_name} (score ${candidate.score}) qualified via override`);
    }
  } else {
    console.log("  override event (already exists)");
  }

  console.log("Done.");
  await admin.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
