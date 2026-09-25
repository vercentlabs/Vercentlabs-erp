#!/usr/bin/env node
// Enriches the existing "Vercentlabs" Lead Sources dataset with F004-specific
// realism the base demo seed never sets: a default source, descriptions,
// and (transiently, for screenshot purposes) an inactive state — using the
// app's own governed lead-source-operations.js functions, never raw SQL for
// operational fields. Local-only, same convention as the other
// scripts/qa/seed-*.mjs scripts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { updateCrmLeadSource } from "../../services/api/src/index.js";
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
    `SELECT u.id FROM users u JOIN organization_memberships om ON om.user_id=u.id WHERE om.organization_id=$1 AND om.status='active' ORDER BY om.created_at ASC LIMIT 1`,
    [organizationId],
  )).rows[0];
  const context = { organizationId, userId: owner.id, allowAllCompanies: true, permissions: [], roleSlugs: ["organization_owner"] };

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

  const sources = (await admin.query(
    `SELECT id, name, description, is_default, updated_at FROM tenant.crm_lead_sources WHERE organization_id=$1 ORDER BY name`,
    [organizationId],
  )).rows;
  const byName = Object.fromEntries(sources.map((s) => [s.name, s]));

  const descriptions = {
    "Company Website": "Inbound enquiries from the public website contact and pricing forms.",
    "Cold Outreach": "Outbound prospecting by the sales team — calls and cold emails.",
    "Trade Show": "Leads collected at industry trade shows and logistics expos.",
    "LinkedIn Ads": "Paid lead-gen campaigns run on LinkedIn.",
    "Partner Network": "Leads referred by our reseller and implementation partners.",
    "Referral Program": "Existing-customer referral program.",
  };

  console.log(`Enriching F004 Lead Sources demo data for "${ORG_NAME}" (${organizationId})...`);

  for (const [name, description] of Object.entries(descriptions)) {
    const row = byName[name];
    if (!row) continue;
    if (row.description) {
      console.log(`  description (already set): ${name}`);
      continue;
    }
    await withTx((client) => updateCrmLeadSource(client, context, row.id, { description }, row.updated_at));
    console.log(`  description set: ${name}`);
  }

  const websiteSource = byName["Company Website"];
  if (websiteSource && !websiteSource.is_default) {
    const fresh = (await admin.query(`SELECT updated_at FROM tenant.crm_lead_sources WHERE id=$1`, [websiteSource.id])).rows[0];
    await withTx((client) => updateCrmLeadSource(client, context, websiteSource.id, { isDefault: true }, fresh.updated_at));
    console.log("  default source set: Company Website");
  } else {
    console.log("  default source (already set)");
  }

  console.log("Done.");
  await admin.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
