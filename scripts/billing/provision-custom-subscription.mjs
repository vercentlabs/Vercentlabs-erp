#!/usr/bin/env node
// Operator-only: provision a contracted Custom plan for one organisation.
// Tenant users can never reach this; it needs the migration/owner database
// credential and writes an audited billing.custom.provisioned event.
//
//   node scripts/billing/provision-custom-subscription.mjs --contract contract.json          (preview)
//   node scripts/billing/provision-custom-subscription.mjs --contract contract.json --confirm (apply)
//
// contract.json:
//   { "organizationId": "...", "users": 50, "modules": ["*"] | ["crm","sales"],
//     "limits": { "companies": 5 }, "contractReference": "VL-2026-001",
//     "startsAt": "2026-10-01", "endsAt": "2027-09-30", "notes": "optional" }
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import pg from "pg";

import { provisionCustomSubscription } from "../../services/api/src/core/billing/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
}

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : null;
};
const contractPath = argument("--contract");
if (!contractPath) {
  console.error("Usage: provision-custom-subscription.mjs --contract <file.json> [--confirm]");
  process.exit(2);
}
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const confirm = process.argv.includes("--confirm");

const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL, application_name: "vercentlabs-billing-custom-provisioning" });
await client.connect();
try {
  const organization = (await client.query(`SELECT id, name FROM organizations WHERE id = $1`, [contract.organizationId])).rows[0];
  if (!organization) throw new Error("Organisation not found.");
  console.log(`Organisation: ${organization.name} (${organization.id})`);
  console.log(`Contract: ${contract.contractReference}, ${contract.users} users, modules ${JSON.stringify(contract.modules)}, ${contract.startsAt} -> ${contract.endsAt}`);
  if (!confirm) {
    console.log("\nPreview only. Re-run with --confirm to apply.");
  } else {
    const result = await provisionCustomSubscription(client, { ...contract, actorUserId: null });
    console.log("\nProvisioned:", JSON.stringify(result));
  }
} finally {
  await client.end();
}
