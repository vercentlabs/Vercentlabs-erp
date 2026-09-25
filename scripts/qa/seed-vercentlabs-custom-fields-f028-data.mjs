#!/usr/bin/env node
// F028 Custom fields — the demo org had no custom fields at all. Creates a
// small set on Opportunity and Lead through the governed definition path,
// then sets and later changes values on one deal (as its owner, through
// setCustomFieldValues) so the record shows current values and the
// append-only change history. Local-only, idempotent.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { createCustomFieldDefinition, setCustomFieldValues } from "../../services/api/src/index.js";
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
const DEAL = "323a6116-6eec-4523-90bf-053d20f5cf80"; // Northgate Engineering Works — Custom Reporting Add-on (Atharva's open deal)

const FIELDS = [
  { entityType: "opportunity", fieldKey: "plant_count", label: "Number of plants", dataType: "number" },
  { entityType: "opportunity", fieldKey: "procurement_route", label: "Procurement route", dataType: "select", options: ["Direct", "Tender", "Reseller"], required: true },
  { entityType: "opportunity", fieldKey: "strategic_account", label: "Strategic account", dataType: "boolean" },
  { entityType: "opportunity", fieldKey: "go_live_target", label: "Go-live target", dataType: "date" },
  { entityType: "lead", fieldKey: "erp_in_use", label: "Current ERP", dataType: "select", options: ["Tally", "SAP Business One", "Excel", "Other"] },
];

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
    permissions: ["crm.records.view_all", "crm.settings.manage", "crm.opportunities.manage", "crm.leads.manage", "crm.leads.view_sensitive"], roleSlugs: ["organization_owner"],
  };
  async function withTx(fn) {
    await admin.query("BEGIN");
    try { await setTenantContext(admin, organizationId); const r = await fn(admin); await admin.query("COMMIT"); return r; }
    catch (e) { await admin.query("ROLLBACK"); throw e; }
  }
  console.log("Seeding F028 custom fields demo data...");

  for (const field of FIELDS) {
    const exists = (await admin.query(`SELECT 1 FROM custom_field_definitions WHERE organization_id=$1 AND entity_type=$2 AND field_key=$3`, [organizationId, field.entityType, field.fieldKey])).rows[0];
    if (exists) { console.log(`Already present: ${field.entityType}.${field.fieldKey}`); continue; }
    await withTx((c) => createCustomFieldDefinition(c, context, field));
    console.log(`Created ${field.entityType} field "${field.label}"`);
  }

  const changes = Number((await admin.query(`SELECT count(*)::int n FROM custom_field_value_history WHERE organization_id=$1 AND entity_id=$2`, [organizationId, DEAL])).rows[0].n);
  if (changes > 0) console.log(`Already present: ${changes} value change(s) on the demo deal`);
  else {
    await withTx((c) => setCustomFieldValues(c, context, "opportunity", DEAL, { procurement_route: "Tender", plant_count: 2, strategic_account: "false", go_live_target: "2027-01-15" }));
    await withTx((c) => setCustomFieldValues(c, context, "opportunity", DEAL, { plant_count: 3, strategic_account: true }));
    await withTx((c) => setCustomFieldValues(c, context, "opportunity", DEAL, { procurement_route: "Direct" }));
    console.log("Set values on the demo deal, then changed three of them");
  }
  console.log("Done.");
  await admin.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
