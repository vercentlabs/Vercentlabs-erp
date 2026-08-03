import assert from "node:assert/strict";
import fs from "node:fs";
const required = [
  "services/api/src/procurement/governance.js",
  "services/api/src/procurement/governance.d.ts",
  "services/api/tests/procurement-governance-stage10.test.mjs",
  "database/tenant/migrations/026_procurement_supplier_lifecycle_governance.sql",
  "apps/web/src/app/api/procurement/governance/route.ts",
  "apps/web/src/app/api/procurement/governance/[entityType]/[id]/route.ts",
  "apps/web/src/app/(app)/procurement/governance/page.tsx",
  "apps/web/scripts/verify-procurement-governance-live.mjs",
  "docs/implementation/stages/STAGE_10_PROCUREMENT_SUPPLIER_LIFECYCLE_GOVERNANCE.md",
];
for (const file of required)
  assert.ok(fs.existsSync(file), `${file} is missing`);
const service = fs.readFileSync(
  "services/api/src/procurement/governance.js",
  "utf8",
);
for (const symbol of [
  "evaluateSupplierGovernance",
  "evaluateRequisitionHealth",
  "evaluateSourcingHealth",
  "evaluatePurchaseOrderHealth",
  "evaluateReceiptHealth",
  "buildProcurementGovernanceSummary",
  "getProcurementGovernanceDashboard",
  "assessProcurementRecordReadiness",
  "captureProcurementGovernanceSnapshot",
  "getProcurementGovernanceTimeline",
  "listProcurementSavedViews",
  "saveProcurementView",
  "deleteProcurementSavedView",
  "upsertProcurementExceptionCase",
  "bulkManageProcurementExceptions",
]) {
  assert.match(service, new RegExp(`export (async )?function ${symbol}`));
}
const migration = fs.readFileSync(
  "database/tenant/migrations/026_procurement_supplier_lifecycle_governance.sql",
  "utf8",
);
for (const table of [
  "procurement_governance_policies",
  "procurement_governance_saved_views",
  "procurement_governance_exception_cases",
  "procurement_governance_snapshots",
])
  assert.match(migration, new RegExp(`tenant\\.${table}`));
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
assert.match(migration, /tenant_organization_isolation/);
const apiIndex = fs.readFileSync("services/api/src/index.js", "utf8");
assert.match(apiIndex, /procurement\/governance\.js/);
const page = fs.readFileSync(
  "apps/web/src/app/(app)/procurement/governance/page.tsx",
  "utf8",
);
assert.match(page, /Supplier, sourcing and purchasing control tower/);
assert.match(page, /getProcurementGovernanceDashboard/);
const routes = fs.readFileSync(
  "apps/web/src/app/api/procurement/governance/route.ts",
  "utf8",
);
assert.match(routes, /bulkManageProcurementExceptions/);
assert.match(routes, /saveProcurementView/);
const existing = fs.readFileSync(
  "services/api/src/procurement/index.js",
  "utf8",
);
for (const capability of [
  "createProcurementRecord",
  "transitionProcurementRecord",
  "awardSourcingEvent",
  "amendPurchaseOrder",
  "runProcurementMatch",
  "getProcurementDashboard",
  "getProcurementReport",
])
  assert.match(existing, new RegExp(`export async function ${capability}`));
const mobile = fs.readFileSync(
  "apps/mobile/src/core/modules/web-parity.ts",
  "utf8",
);
assert.match(mobile, /web: "\/procurement\/governance"/);
console.log(
  "Stage 10 Procurement supplier lifecycle governance contract verified.",
);
