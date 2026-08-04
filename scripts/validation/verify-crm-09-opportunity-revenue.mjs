import assert from "node:assert/strict";
import fs from "node:fs";
const required = [
  "database/tenant/migrations/036_crm_opportunity_revenue_intelligence.sql",
  "services/api/src/crm/opportunity-revenue-intelligence.js",
  "services/api/src/crm/opportunity-revenue-intelligence.d.ts",
  "services/api/tests/crm-opportunity-revenue-crm09.test.mjs",
  "apps/web/src/app/(app)/crm/opportunity-revenue/page.tsx",
  "apps/web/src/app/api/crm/opportunity-revenue/route.ts",
  "apps/web/src/app/api/mobile/v1/crm/opportunity-revenue/route.ts",
  "apps/web/scripts/verify-crm-opportunity-revenue-live.mjs",
];
for (const file of required)
  assert.ok(fs.existsSync(file), `${file} is required.`);
const migration = fs.readFileSync(required[0], "utf8");
for (const table of [
  "crm_opportunity_revenue_schedules",
  "crm_opportunity_team_members",
  "crm_opportunity_revenue_splits",
  "crm_mutual_action_plans",
  "crm_mutual_action_plan_milestones",
  "crm_opportunity_templates",
  "crm_opportunity_clone_events",
  "crm_win_loss_reviews",
  "crm_predictive_forecast_snapshots",
  "crm_quota_seasonality_allocations",
  "crm_opportunity_revenue_acceptance_evidence",
]) {
  assert.match(
    migration,
    new RegExp(`CREATE TABLE IF NOT EXISTS tenant\\.${table}`),
  );
}
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
const ledger = JSON.parse(
  fs.readFileSync(
    "docs/implementation/four-module-feature-evidence.json",
    "utf8",
  ),
);
for (const id of [
  "CRM-051",
  "CRM-052",
  "CRM-053",
  "CRM-073",
  "CRM-074",
  "CRM-075",
  "CRM-076",
  "CRM-077",
]) {
  const entry = ledger.find((row) => row.id === id);
  assert.equal(
    entry?.registerStatus,
    "Implemented",
    `${id} must be implemented.`,
  );
  assert.equal(entry?.acceptanceStatus, "verified", `${id} must be verified.`);
  assert.ok(entry?.testPaths?.length >= 3, `${id} needs executable evidence.`);
}
console.log("CRM-09 opportunity revenue and forecasting contract verified.");
