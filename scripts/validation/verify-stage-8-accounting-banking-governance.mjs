import assert from "node:assert/strict";
import fs from "node:fs";

const required = [
  "services/api/src/accounting/banking-governance.js",
  "services/api/src/accounting/banking-governance.d.ts",
  "services/api/tests/accounting-banking-governance-stage8.test.mjs",
  "database/tenant/migrations/024_accounting_banking_close_governance.sql",
  "apps/web/src/app/api/accounting/banking/operations/route.ts",
  "apps/web/src/app/api/accounting/banking/statements/[id]/actions/route.ts",
  "apps/web/src/app/api/accounting/banking/reconciliations/[id]/actions/route.ts",
  "apps/web/src/app/(app)/accounting/banking/page.tsx",
  "apps/web/scripts/verify-accounting-banking-governance-live.mjs",
  "docs/implementation/stages/STAGE_8_ACCOUNTING_BANKING_GOVERNANCE.md",
];

for (const file of required) {
  assert.ok(fs.existsSync(file), `${file} is missing`);
}

const service = fs.readFileSync(
  "services/api/src/accounting/banking-governance.js",
  "utf8",
);
for (const symbol of [
  "evaluateBankStatementHealth",
  "buildBankingGovernanceSummary",
  "getBankingGovernanceDashboard",
  "assessBankStatementReadiness",
  "captureBankingGovernanceSnapshot",
  "getBankStatementGovernanceTimeline",
  "listBankingSavedViews",
  "saveBankingView",
  "deleteBankingSavedView",
  "upsertReconciliationExceptionCase",
  "bulkManageReconciliationExceptions",
  "captureCashPositionSnapshot",
  "captureCloseReadinessSnapshot",
]) {
  assert.match(service, new RegExp(`export (async )?function ${symbol}`));
}

const declarations = fs.readFileSync(
  "services/api/src/accounting/banking-governance.d.ts",
  "utf8",
);
for (const symbol of [
  "getBankingGovernanceDashboard",
  "assessBankStatementReadiness",
  "captureBankingGovernanceSnapshot",
  "upsertReconciliationExceptionCase",
  "captureCashPositionSnapshot",
  "captureCloseReadinessSnapshot",
]) {
  assert.match(declarations, new RegExp(`export function ${symbol}`));
}

const accountingIndex = fs.readFileSync(
  "services/api/src/accounting/index.js",
  "utf8",
);
assert.match(accountingIndex, /banking-governance\.js/);

const migration = fs.readFileSync(
  "database/tenant/migrations/024_accounting_banking_close_governance.sql",
  "utf8",
);
for (const table of [
  "accounting_banking_governance_policies",
  "accounting_banking_saved_views",
  "accounting_banking_governance_snapshots",
  "accounting_reconciliation_exception_cases",
  "accounting_cash_position_snapshots",
  "accounting_close_readiness_snapshots",
]) {
  assert.match(migration, new RegExp(`tenant\\.${table}`));
}
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
assert.match(migration, /tenant_organization_isolation/);

const statementActions = fs.readFileSync(
  "apps/web/src/app/api/accounting/banking/statements/[id]/actions/route.ts",
  "utf8",
);
assert.match(statementActions, /captureBankingGovernanceSnapshot/);

const reconciliationActions = fs.readFileSync(
  "apps/web/src/app/api/accounting/banking/reconciliations/[id]/actions/route.ts",
  "utf8",
);
assert.match(reconciliationActions, /captureBankingGovernanceSnapshot/);

const operations = fs.readFileSync(
  "apps/web/src/app/api/accounting/banking/operations/route.ts",
  "utf8",
);
assert.match(operations, /captureCashPositionSnapshot/);
assert.match(operations, /captureCloseReadinessSnapshot/);
assert.match(operations, /bulkManageReconciliationExceptions/);

const bankingPage = fs.readFileSync(
  "apps/web/src/app/(app)/accounting/banking/page.tsx",
  "utf8",
);
assert.match(bankingPage, /getBankingGovernanceDashboard/);
assert.match(bankingPage, /Close readiness/);

const bankingEngine = fs.readFileSync(
  "services/api/src/accounting/banking.js",
  "utf8",
);
for (const existingCapability of [
  "importBankStatement",
  "suggestBankMatches",
  "startBankReconciliation",
  "matchBankStatementLine",
  "completeBankReconciliation",
]) {
  assert.match(
    bankingEngine,
    new RegExp(`export async function ${existingCapability}`),
  );
}

const closeEngine = fs.readFileSync(
  "services/api/src/accounting/close.js",
  "utf8",
);
assert.match(closeEngine, /export async function getPeriodCloseBlockers/);
assert.match(closeEngine, /export async function createCloseRun/);

const forecastEngine = fs.readFileSync(
  "services/api/src/accounting/forecast.js",
  "utf8",
);
assert.match(forecastEngine, /export async function generateCashForecast/);

const mobileParity = fs.readFileSync(
  "apps/mobile/src/core/modules/web-parity.ts",
  "utf8",
);
assert.match(mobileParity, /web: "\/accounting\/banking"/);
assert.match(mobileParity, /web: "\/accounting\/close"/);

console.log(
  "Stage 8 Accounting banking and close governance contract verified.",
);
