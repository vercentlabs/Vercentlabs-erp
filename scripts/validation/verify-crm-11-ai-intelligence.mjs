import assert from "node:assert/strict";
import fs from "node:fs";
const files = [
  "database/tenant/migrations/038_crm_ai_intelligence.sql",
  "services/api/src/crm/ai-intelligence.js",
  "services/api/src/crm/ai-intelligence.d.ts",
  "apps/web/src/app/api/crm/ai-intelligence/route.ts",
  "apps/web/src/app/(app)/crm/ai-intelligence/page.tsx",
  "services/api/tests/crm-ai-intelligence-crm11.test.mjs",
];
for (const f of files) assert.ok(fs.existsSync(f), `${f} is required`);
const ledger = JSON.parse(
  fs.readFileSync(
    "docs/implementation/four-module-feature-evidence.json",
    "utf8",
  ),
);
for (const id of ["CRM-007", "CRM-008", "CRM-009", "CRM-043"])
  assert.equal(ledger.find((x) => x.id === id)?.registerStatus, "Implemented");
assert.match(fs.readFileSync(files[0], "utf8"), /FORCE ROW LEVEL SECURITY/);
console.log("CRM-11 AI intelligence contract verified.");
