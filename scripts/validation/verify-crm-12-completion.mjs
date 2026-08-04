import assert from "node:assert/strict";
import fs from "node:fs";
const required = [
  "database/tenant/migrations/039_crm_offline_completion.sql",
  "services/api/src/crm/offline-sync.js",
  "services/api/src/crm/offline-sync.d.ts",
  "apps/web/src/app/api/mobile/v1/crm/offline-sync/route.ts",
  "apps/mobile/src/modules/crm/data/offline-hardening.ts",
  "services/api/tests/crm-offline-sync-crm12.test.mjs",
];
for (const f of required) assert.ok(fs.existsSync(f), `${f} is required`);
const ledger = JSON.parse(
  fs.readFileSync(
    "docs/implementation/four-module-feature-evidence.json",
    "utf8",
  ),
);
const crm = ledger.filter((x) => x.module === "CRM");
assert.equal(crm.length, 83, "CRM register must contain 83 capabilities");
for (const row of crm) {
  assert.equal(
    row.registerStatus,
    "Implemented",
    `${row.id} is not implemented`,
  );
  assert.equal(row.acceptanceStatus, "verified", `${row.id} is not accepted`);
  assert.ok(
    row.implementationPaths?.length,
    `${row.id} lacks implementation paths`,
  );
  assert.ok(row.testPaths?.length, `${row.id} lacks test paths`);
}
const sql = fs.readFileSync(required[0], "utf8");
assert.match(sql, /FORCE ROW LEVEL SECURITY/);
assert.match(sql, /crm_final_acceptance_runs/);
console.log("CRM-12 final 83-capability contract verified.");
