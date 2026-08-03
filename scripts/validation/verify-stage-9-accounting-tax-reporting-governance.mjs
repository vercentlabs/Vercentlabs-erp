import assert from "node:assert/strict";
import fs from "node:fs";

const required = [
  "services/api/src/accounting/tax-reporting-governance.js",
  "services/api/src/accounting/tax-reporting-governance.d.ts",
  "services/api/tests/accounting-tax-reporting-governance-stage9.test.mjs",
  "database/tenant/migrations/025_accounting_tax_reporting_governance.sql",
  "apps/web/src/app/api/accounting/tax/operations/route.ts",
  "apps/web/src/app/api/accounting/tax/returns/route.ts",
  "apps/web/src/app/api/accounting/tax/returns/[id]/actions/route.ts",
  "apps/web/src/app/(app)/accounting/tax/page.tsx",
  "apps/web/src/app/(app)/accounting/reports/page.tsx",
  "apps/web/scripts/verify-accounting-tax-reporting-governance-live.mjs",
  "docs/implementation/stages/STAGE_9_ACCOUNTING_TAX_REPORTING_GOVERNANCE.md",
];

for (const file of required) {
  assert.ok(fs.existsSync(file), `${file} is missing`);
}

const service = fs.readFileSync(
  "services/api/src/accounting/tax-reporting-governance.js",
  "utf8",
);
for (const symbol of [
  "evaluateTaxReturnHealth",
  "buildTaxGovernanceSummary",
  "getTaxReportingGovernanceDashboard",
  "assessTaxReturnReadiness",
  "captureTaxGovernanceSnapshot",
  "getTaxReturnGovernanceTimeline",
  "listTaxSavedViews",
  "saveTaxView",
  "deleteTaxSavedView",
  "upsertTaxExceptionCase",
  "bulkManageTaxExceptions",
  "captureFinancialReportingSnapshot",
]) {
  assert.match(service, new RegExp(`export (async )?function ${symbol}`));
}

const declarations = fs.readFileSync(
  "services/api/src/accounting/tax-reporting-governance.d.ts",
  "utf8",
);
for (const symbol of [
  "getTaxReportingGovernanceDashboard",
  "assessTaxReturnReadiness",
  "captureTaxGovernanceSnapshot",
  "upsertTaxExceptionCase",
  "captureFinancialReportingSnapshot",
]) {
  assert.match(declarations, new RegExp(`export function ${symbol}`));
}

const accountingIndex = fs.readFileSync(
  "services/api/src/accounting/index.js",
  "utf8",
);
assert.match(accountingIndex, /tax-reporting-governance\.js/);

const migration = fs.readFileSync(
  "database/tenant/migrations/025_accounting_tax_reporting_governance.sql",
  "utf8",
);
for (const table of [
  "accounting_tax_reporting_policies",
  "accounting_tax_saved_views",
  "accounting_tax_exception_cases",
  "accounting_tax_governance_snapshots",
  "accounting_financial_reporting_snapshots",
]) {
  assert.match(migration, new RegExp(`tenant\\.${table}`));
}
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
assert.match(migration, /tenant_organization_isolation/);

const operations = fs.readFileSync(
  "apps/web/src/app/api/accounting/tax/operations/route.ts",
  "utf8",
);
assert.match(operations, /captureFinancialReportingSnapshot/);
assert.match(operations, /bulkManageTaxExceptions/);
assert.match(operations, /getTaxReportingGovernanceDashboard/);

const returnRoute = fs.readFileSync(
  "apps/web/src/app/api/accounting/tax/returns/route.ts",
  "utf8",
);
assert.match(returnRoute, /captureTaxGovernanceSnapshot/);

const returnAction = fs.readFileSync(
  "apps/web/src/app/api/accounting/tax/returns/[id]/actions/route.ts",
  "utf8",
);
assert.match(returnAction, /captureTaxGovernanceSnapshot/);

const taxPage = fs.readFileSync(
  "apps/web/src/app/(app)/accounting/tax/page.tsx",
  "utf8",
);
assert.match(taxPage, /getTaxReportingGovernanceDashboard/);
assert.match(taxPage, /Exception ownership/);

const reportsPage = fs.readFileSync(
  "apps/web/src/app/(app)/accounting/reports/page.tsx",
  "utf8",
);
assert.match(reportsPage, /Immutable reporting evidence/);
assert.match(reportsPage, /reportingSnapshots/);

const taxEngine = fs.readFileSync("services/api/src/accounting/tax.js", "utf8");
for (const existingCapability of [
  "recordDocumentTaxLedger",
  "createTaxReturn",
  "updateTaxReturnStatus",
  "listTaxReturns",
]) {
  assert.match(
    taxEngine,
    new RegExp(`export async function ${existingCapability}`),
  );
}

const reportEngine = fs.readFileSync(
  "services/api/src/accounting/reports.js",
  "utf8",
);
for (const existingCapability of [
  "getTrialBalance",
  "getProfitAndLoss",
  "getBalanceSheet",
  "getCashFlow",
  "getTaxSummary",
  "getSubledgerReconciliation",
  "getAccountingReport",
]) {
  assert.match(
    reportEngine,
    new RegExp(`export async function ${existingCapability}`),
  );
}

const mobileParity = fs.readFileSync(
  "apps/mobile/src/core/modules/web-parity.ts",
  "utf8",
);
assert.match(mobileParity, /web: "\/accounting\/tax"/);
assert.match(mobileParity, /web: "\/accounting\/reports"/);

console.log(
  "Stage 9 Accounting tax and reporting governance contract verified.",
);
