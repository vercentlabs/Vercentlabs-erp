import assert from "node:assert/strict";
import fs from "node:fs";

const requiredFiles = [
  "database/tenant/migrations/030_crm_customer_success.sql",
  "services/api/src/crm/customer-success.js",
  "services/api/src/crm/customer-success.d.ts",
  "services/api/tests/crm-customer-success-crm03.test.mjs",
  "apps/web/src/app/api/crm/customer-success/dashboard/route.ts",
  "apps/web/src/app/api/crm/customer-success/readiness/route.ts",
  "apps/web/src/app/api/crm/customer-success/accounts/[id]/route.ts",
  "apps/web/src/app/api/crm/customer-success/usage/route.ts",
  "apps/web/src/app/api/crm/customer-success/feedback/route.ts",
  "apps/web/src/app/api/mobile/v1/crm/customer-success/route.ts",
  "apps/web/src/app/(app)/crm/customer-success/page.tsx",
  "apps/web/scripts/verify-crm-customer-success-live.mjs",
  "docs/implementation/stages/CRM_03_CUSTOMER_SUCCESS.md",
];
for (const file of requiredFiles)
  assert.ok(fs.existsSync(file), `Missing CRM-03 file: ${file}`);
const migration = fs.readFileSync(requiredFiles[0], "utf8");
for (const table of [
  "crm_success_plan_templates",
  "crm_customer_success_plans",
  "crm_customer_success_milestones",
  "crm_product_usage_events",
  "crm_customer_feedback_responses",
  "crm_customer_health_snapshots",
  "crm_renewal_cases",
  "crm_churn_interventions",
  "crm_customer_success_acceptance_runs",
]) {
  assert.match(
    migration,
    new RegExp(`CREATE TABLE IF NOT EXISTS tenant\\.${table}`),
  );
}
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
assert.match(migration, /crm_customer_success_immutable_row/);
const service = fs.readFileSync(requiredFiles[1], "utf8");
for (const symbol of [
  "createCustomerSuccessPlan",
  "updateCustomerSuccessMilestone",
  "ingestProductUsageEvent",
  "recordCustomerFeedback",
  "upsertRenewalCase",
  "createChurnIntervention",
  "recalculateCustomerHealth",
  "getCustomerSuccessDashboard",
  "recordCrmCustomerSuccessAcceptance",
  "getCrmCustomerSuccessReadiness",
])
  assert.match(service, new RegExp(`export async function ${symbol}`));
const evidence = JSON.parse(
  fs.readFileSync(
    "docs/implementation/four-module-feature-evidence.json",
    "utf8",
  ),
);
for (const id of ["CRM-031", "CRM-032", "CRM-033", "CRM-034", "CRM-047"]) {
  const row = evidence.find((entry) => entry.id === id);
  assert.equal(
    row?.registerStatus,
    "Implemented",
    `${id} is not implemented in the evidence register.`,
  );
  assert.equal(
    row?.acceptanceStatus,
    "verified",
    `${id} lacks verified acceptance evidence.`,
  );
  assert.ok(
    row?.implementationPaths?.length >= 3,
    `${id} lacks implementation paths.`,
  );
  assert.ok(row?.testPaths?.length >= 3, `${id} lacks test paths.`);
}
const rootPackage = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.ok(rootPackage.scripts["verify:crm-03"]);
assert.ok(rootPackage.scripts["verify:crm-03-complete"]);
const webPackage = JSON.parse(fs.readFileSync("apps/web/package.json", "utf8"));
assert.ok(webPackage.scripts["crm:customer-success:live"]);
console.log("CRM-03 customer-success contract verified.");
