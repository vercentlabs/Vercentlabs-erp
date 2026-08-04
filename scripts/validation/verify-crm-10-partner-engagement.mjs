import assert from "node:assert/strict";
import fs from "node:fs";
const required = [
  "database/tenant/migrations/037_crm_partner_engagement.sql",
  "services/api/src/crm/partner-engagement.js",
  "services/api/src/crm/partner-engagement.d.ts",
  "apps/web/src/app/api/crm/partner-engagement/route.ts",
  "apps/web/src/app/(app)/crm/partner-engagement/page.tsx",
  "apps/web/src/app/api/mobile/v1/crm/partner-engagement/route.ts",
  "services/api/tests/crm-partner-engagement-crm10.test.mjs",
];
for (const file of required)
  assert.ok(fs.existsSync(file), `${file} is required`);
const ledger = JSON.parse(
  fs.readFileSync(
    "docs/implementation/four-module-feature-evidence.json",
    "utf8",
  ),
);
for (const id of [
  "CRM-037",
  "CRM-044",
  "CRM-048",
  "CRM-050",
  "CRM-055",
  "CRM-078",
  "CRM-079",
  "CRM-080",
  "CRM-082",
  "CRM-083",
])
  assert.equal(
    ledger.find((x) => x.id === id)?.registerStatus,
    "Implemented",
    `${id} must be implemented`,
  );
const sql = fs.readFileSync(required[0], "utf8");
assert.match(sql, /FORCE ROW LEVEL SECURITY/);
assert.match(sql, /crm_partner_engagement_acceptance_evidence/);
console.log("CRM-10 partner-engagement contract verified.");
