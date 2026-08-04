import assert from "node:assert/strict";
import fs from "node:fs";
const required = [
  "database/tenant/migrations/035_crm_lead_intelligence.sql",
  "services/api/src/crm/lead-intelligence.js",
  "services/api/src/crm/lead-intelligence.d.ts",
  "services/api/tests/crm-lead-intelligence-crm08.test.mjs",
  "apps/web/src/app/(app)/crm/lead-intelligence/page.tsx",
  "apps/web/src/app/api/crm/lead-intelligence/dashboard/route.ts",
  "apps/web/src/app/api/mobile/v1/crm/lead-intelligence/route.ts",
  "apps/web/scripts/verify-crm-lead-intelligence-live.mjs",
];
for (const path of required) assert.ok(fs.existsSync(path), `Missing ${path}`);
const migration = fs.readFileSync(required[0], "utf8");
for (const table of [
  "crm_lead_scoring_models",
  "crm_lead_behavior_events",
  "crm_lead_score_snapshots",
  "crm_lead_sla_policies",
  "crm_lead_sla_cases",
  "crm_lead_nurture_queue",
  "crm_lead_intelligence_acceptance_runs",
]) {
  assert.match(
    migration,
    new RegExp(`CREATE TABLE IF NOT EXISTS tenant\\.${table}`),
  );
}
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
const service = fs.readFileSync(required[1], "utf8");
for (const name of [
  "recordLeadBehaviorEvent",
  "recalculateLeadScore",
  "openLeadSlaCase",
  "recordLeadResponse",
  "scanLeadSlaBreaches",
  "refreshLeadNurtureQueue",
  "getLeadIntelligenceDashboard",
  "getCrmLeadIntelligenceReadiness",
])
  assert.match(service, new RegExp(`export async function ${name}`));
const ledger = JSON.parse(
  fs.readFileSync(
    "docs/implementation/four-module-feature-evidence.json",
    "utf8",
  ),
);
for (const id of ["CRM-060", "CRM-061", "CRM-062"]) {
  const item = ledger.find((entry) => entry.id === id);
  assert.equal(item?.registerStatus, "Implemented");
  assert.equal(item?.acceptanceStatus, "verified");
}
console.log("CRM-08 lead intelligence contract verified.");
