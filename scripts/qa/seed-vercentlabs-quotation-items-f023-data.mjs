#!/usr/bin/env node
// F023 Opportunity-to-quotation conversion — verifying the new "Convert to
// Quotation" action end to end requires actually saving a quotation, which
// requires at least one active sales item and unit of measure; the demo org
// has neither (a Sales-module master-data gap, not an F023-specific one;
// seedBusinessDataFoundation is not used here since it requires a primary
// Branch this org doesn't have, and currencies already exist). Seeds one
// UOM and one item via the governed createBusinessDataRecord — never raw
// SQL. Local-only, safe to run more than once.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { createBusinessDataRecord } from "../../services/api/src/index.js";
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
    `SELECT id FROM users u JOIN organization_memberships om ON om.user_id=u.id WHERE om.organization_id=$1 AND om.status='active' ORDER BY om.created_at ASC LIMIT 1`,
    [organizationId],
  )).rows[0];
  const context = {
    organizationId, userId: owner.id, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true,
    permissions: ["crm.records.view_all"], roleSlugs: ["organization_owner"],
  };
  async function withTx(fn) {
    await admin.query("BEGIN");
    try { await setTenantContext(admin, organizationId); const r = await fn(admin); await admin.query("COMMIT"); return r; }
    catch (e) { await admin.query("ROLLBACK"); throw e; }
  }

  let uom = (await admin.query(`SELECT id FROM tenant.units_of_measure WHERE organization_id=$1 AND code='EA' LIMIT 1`, [organizationId])).rows[0];
  if (!uom) {
    uom = await withTx((c) => createBusinessDataRecord(c, context, "units-of-measure", {
      code: "EA", name: "Each", category: "quantity", decimalPlaces: 0, isBase: true, status: "active",
    }));
    console.log(`Created UOM ${uom.code} (${uom.id})`);
  } else console.log("Already present: EA unit of measure");

  const existingItem = (await admin.query(`SELECT id FROM tenant.items WHERE organization_id=$1 AND code=$2`, [organizationId, "SVC-CONSULT"])).rows[0];
  if (!existingItem) {
    const item = await withTx((c) => createBusinessDataRecord(c, context, "items", {
      code: "SVC-CONSULT",
      name: "Consulting services (per hour)",
      description: "Standard consulting/services line item used for quotations converted from a CRM Opportunity.",
      itemType: "service",
      uomId: uom.id,
      trackInventory: false,
      trackingType: "none",
      allowNegativeStock: false,
      valuationMethod: "standard",
      standardCost: 0,
      salesPrice: 5000,
      purchasePrice: 0,
      status: "active",
    }));
    console.log(`Created item ${item.code} (${item.id})`);
  } else console.log("Already present: SVC-CONSULT item");

  await admin.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
