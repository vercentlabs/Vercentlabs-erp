import fs from "node:fs";
import assert from "node:assert/strict";
const required = [
  "services/api/src/crm/lead-operations.js",
  "database/tenant/migrations/018_crm_lead_operations.sql",
  "services/api/tests/crm-lead-operations-stage2cd.test.mjs",
  "apps/web/src/app/api/crm/leads/operations/route.ts",
];
for (const file of required) assert.ok(fs.existsSync(file), `Missing ${file}`);
const migration = fs.readFileSync(required[1], "utf8");
for (const table of [
  "crm_lead_saved_views",
  "crm_lead_assignment_events",
  "crm_lead_sla_policies",
])
  assert.match(
    migration,
    new RegExp(`CREATE TABLE IF NOT EXISTS tenant\\.${table}`),
  );
const service = fs.readFileSync(required[0], "utf8");
for (const symbol of [
  "evaluateLeadReadiness",
  "getLeadTimeline",
  "previewLeadAssignment",
  "bulkUpdateLeads",
  "getLeadOperationsDashboard",
])
  assert.match(service, new RegExp(`export (async )?function ${symbol}`));
console.log("Stage 2C + 2D lead operations contract verified.");
