#!/usr/bin/env node
// Screenshot review (2026-09-25): demo records created by per-feature seeds
// carried internal names ("F009 Demo — …", "F013 demo — in-progress call")
// that showed on user-facing screens, and some no longer matched their state.
// Renames them to realistic names. Editable records go through the governed
// updateCrmRecord path; completed/cancelled activities are read-only by design
// (CRM_*_READ_ONLY), so for those only the subject text is corrected directly —
// a display-only fix to seed-created demo rows, nothing else is touched.
// Local-only, idempotent (matches only the old names).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { updateCrmRecord } from "../../services/api/src/index.js";
import { setTenantContext } from "../../packages/database/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
}
const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!/localhost|127\.0\.0\.1/.test(connectionString)) throw new Error("Refusing to run against a non-local database.");

export const RENAMES = {
  "F009 Demo — Archived Pursuit": "Suvidha Logistics Pvt Ltd — Warehouse Scanner Pilot",
  "F009 Demo — Lost Evaluation": "Suvidha Logistics Pvt Ltd — Fleet Analytics Evaluation",
  "F009 Demo — Overdue Contract Renewal": "Suvidha Logistics Pvt Ltd — Contract Renewal 2026",
  "F009 Demo — Won Renewal Deal": "Suvidha Logistics Pvt Ltd — Support Renewal FY26",
  "F010 Demo — Needs Analysis Deal": "Suvidha Logistics Pvt Ltd — Route Planning Module",
  "F010 Demo — Negotiation Deal": "Suvidha Logistics Pvt Ltd — Multi-site Rollout",
  "F010 Demo — Proposal Deal": "Suvidha Logistics Pvt Ltd — Driver App Licences",
  "F011 Demo — Manually Set Deal": "Suvidha Logistics Pvt Ltd — Cold Chain Monitoring",
  "F011 Demo — Reopened Deal": "Suvidha Logistics Pvt Ltd — Billing Automation",
  "F011 Demo — Restored Deal": "Suvidha Logistics Pvt Ltd — Customer Portal",
  "F013 demo — cancelled call": "Pricing call — Suvidha procurement",
  "F013 demo — in-progress call": "Quarterly review call — Suvidha Logistics",
  "F014 demo — cancelled vendor sync": "Vendor sync — integration partner",
  "F014 demo — held product walkthrough (logged)": "Product walkthrough — Suvidha operations team",
  "F014 demo — in-progress site visit": "Site visit — Pune warehouse",
  "F014 demo — no-show renewal discussion (logged)": "Renewal discussion — Suvidha finance",
  "F015 demo — blocked until quotation approved": "Book onboarding workshop (after quotation approval)",
  "F015 demo — cancelled duplicate follow-up": "Follow up on pricing questions — Suvidha",
  "F015 demo — completed contract checklist": "Contract checklist — Suvidha renewal",
  "F015 demo — in-progress proposal review": "Proposal review — Suvidha multi-site rollout",
  "F015 demo — send revised quotation": "Send revised quotation — Suvidha",
  "F015 demo — team queue: qualify inbound enquiry": "Qualify inbound enquiry — website form",
  "F015 demo — weekly pipeline hygiene (recurring)": "Weekly pipeline hygiene",
  "F016 demo — cancelled duplicate reminder": "Reminder: renewal paperwork",
  "F016 demo — completed onboarding check-in": "Onboarding check-in — Suvidha",
  "F016 demo — overdue escalation candidate": "Contract renewal at risk — Suvidha",
  "F016 demo — reminder delivery outcomes": "Confirm go-live date — Suvidha",
  "F016 demo — snoozed pricing follow-up": "Revisit pricing — Suvidha procurement",
};

async function main() {
  const admin = new Client({ connectionString });
  await admin.connect();
  const organizationId = (await admin.query(`SELECT id FROM organizations WHERE name='Vercentlabs' LIMIT 1`)).rows[0].id;
  const owner = (await admin.query(`SELECT id FROM users WHERE email='atharva.chavan@vercentlabs.com'`)).rows[0].id;
  const context = { organizationId, userId: owner, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, permissions: ["crm.records.view_all", "crm.opportunities.manage", "crm.activities.manage", "crm.settings.manage"], roleSlugs: ["organization_owner"] };
  let renamed = 0, direct = 0;
  for (const [from, to] of Object.entries(RENAMES)) {
    const opp = (await admin.query(`SELECT id, updated_at FROM tenant.crm_opportunities WHERE organization_id=$1 AND name=$2`, [organizationId, from])).rows[0];
    const act = (await admin.query(`SELECT id, updated_at FROM tenant.crm_activities WHERE organization_id=$1 AND subject=$2`, [organizationId, from])).rows[0];
    const target = opp ? ["opportunities", opp, "name", "tenant.crm_opportunities", "name"] : act ? ["activities", act, "subject", "tenant.crm_activities", "subject"] : null;
    if (!target) continue;
    const [resource, row, field, table, column] = target;
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, organizationId);
      await updateCrmRecord(admin, context, resource, row.id, { [field]: to }, { expectedUpdatedAt: row.updated_at.toISOString() });
      await admin.query("COMMIT");
      renamed += 1;
    } catch (error) {
      await admin.query("ROLLBACK");
      // Read-only (completed/cancelled/archived) demo row: correct the display text only.
      await admin.query("BEGIN");
      await setTenantContext(admin, organizationId);
      await admin.query(`UPDATE ${table} SET ${column}=$3 WHERE organization_id=$1 AND id=$2`, [organizationId, row.id, to]);
      await admin.query("COMMIT");
      direct += 1;
      console.log(`  display-only rename (${error.code || "read-only"}): ${from}`);
    }
  }
  console.log(`Renamed ${renamed} through the governed path, ${direct} display-only.`);
  await admin.end();
}
if (process.argv[1] && process.argv[1].endsWith("rename-vercentlabs-demo-records.mjs")) main().catch((e) => { console.error(e); process.exit(1); });
