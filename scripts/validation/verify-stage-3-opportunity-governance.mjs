import fs from "node:fs";
import assert from "node:assert/strict";
for (const file of [
  "services/api/src/crm/opportunity-operations.js",
  "services/api/src/crm/opportunity-operations.d.ts",
  "database/tenant/migrations/019_crm_opportunity_governance.sql",
  "apps/web/src/app/api/crm/opportunities/operations/route.ts",
])
  assert.ok(fs.existsSync(file), `${file} is missing`);
const migration = fs.readFileSync(
  "database/tenant/migrations/019_crm_opportunity_governance.sql",
  "utf8",
);
for (const table of [
  "crm_opportunity_stage_sla_policies",
  "crm_opportunity_forecast_snapshots",
  "crm_opportunity_saved_views",
])
  assert.match(migration, new RegExp(table));
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
console.log("Stage 3 opportunity governance contract verified.");
