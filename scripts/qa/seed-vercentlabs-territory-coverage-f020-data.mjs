#!/usr/bin/env node
// F020 territory coverage demo data: fills the existing territories' coverage
// (states, cities, industries), adds an Ahilyanagar city territory under
// Maharashtra, and adds a territory assignment rule that routes each lead to
// its own territory by coverage. Governed functions only; local-only; safe to
// run more than once.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";
import { createCrmRecord, saveLeadAssignmentPolicy, updateCrmRecord } from "../../services/api/src/index.js";
import { setTenantContext } from "../../packages/database/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
}
const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!/localhost|127\.0\.0\.1/.test(connectionString)) throw new Error("Refusing to run against a non-local database.");

const db = new Client({ connectionString });
await db.connect();
const organizationId = (await db.query(`SELECT id FROM organizations WHERE name=$1`, [process.env.SEED_ORG_NAME || "Vercentlabs"])).rows[0].id;
const ownerId = (await db.query(`SELECT id FROM users WHERE email='atharva.chavan@vercentlabs.com'`)).rows[0].id;
const karanId = (await db.query(`SELECT id FROM users WHERE email='karan.mehta@vercentlabs.demo'`)).rows[0].id;
const context = { organizationId, userId: ownerId, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, permissions: ["crm.settings.manage", "crm.records.view_all"], roleSlugs: ["organization_owner"] };
async function tx(fn) {
  await db.query("BEGIN");
  try {
    await setTenantContext(db, organizationId);
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
const territory = async (code) => (await db.query(`SELECT id,updated_at,assignment_rules FROM tenant.crm_territories WHERE organization_id=$1 AND code=$2`, [organizationId, code])).rows[0];

const coverage = {
  MAHARASHTRA: { territoryType: "geographic", assignmentRules: { countryCodes: ["IN"], states: ["Maharashtra"] } },
  "MUMBAI-METRO": { territoryType: "geographic", assignmentRules: { countryCodes: ["IN"], states: ["Maharashtra"], cities: ["Mumbai", "Thane", "Navi Mumbai"] } },
  "PUNE-CORRIDOR": { territoryType: "geographic", assignmentRules: { countryCodes: ["IN"], states: ["Maharashtra"], cities: ["Pune", "Pimpri-Chinchwad", "Chakan"] } },
  "LOGISTICS-VERTICAL": { territoryType: "industry", assignmentRules: { industries: ["Logistics", "Freight", "Warehousing"] } },
};
for (const [code, input] of Object.entries(coverage)) {
  const row = await territory(code);
  if (!row) continue;
  if (JSON.stringify(row.assignment_rules) !== "{}") { console.log(`present  coverage ${code}`); continue; }
  await tx((c) => updateCrmRecord(c, context, "territories", row.id, input, { expectedUpdatedAt: row.updated_at.toISOString() }));
  console.log(`done     coverage ${code}`);
}
if (!(await territory("AHILYANAGAR"))) {
  const parent = await territory("MAHARASHTRA");
  await tx((c) => createCrmRecord(c, context, "territories", {
    code: "AHILYANAGAR", name: "Ahilyanagar", territoryType: "geographic", parentTerritoryId: parent?.id ?? null, managerUserId: karanId, status: "active",
    assignmentRules: { countryCodes: ["IN"], states: ["Maharashtra"], cities: ["Ahilyanagar", "Shirdi", "Sangamner"] },
  }));
  console.log("done     territory Ahilyanagar");
} else console.log("present  territory Ahilyanagar");

const policy = (await db.query(`SELECT id FROM tenant.crm_lead_assignment_policies WHERE organization_id=$1 AND name=$2`, [organizationId, "Leads by territory coverage"])).rows[0];
if (!policy) {
  await tx((c) => saveLeadAssignmentPolicy(c, context, { name: "Leads by territory coverage", mode: "territory", sequence: 40, criteria: { countryCode: "IN" }, status: "active" }));
  console.log("done     rule Leads by territory coverage");
} else console.log("present  rule Leads by territory coverage");
await db.end();
