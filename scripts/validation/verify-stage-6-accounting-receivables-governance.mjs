import assert from "node:assert/strict";
import fs from "node:fs";

const required = [
  "services/api/src/accounting/receivables-governance.js",
  "services/api/src/accounting/receivables-governance.d.ts",
  "services/api/tests/accounting-receivables-governance-stage6.test.mjs",
  "database/tenant/migrations/022_accounting_receivables_governance.sql",
  "apps/web/src/app/api/accounting/receivables/operations/route.ts",
  "apps/web/src/app/(app)/accounting/receivables/page.tsx",
  "apps/web/src/app/(app)/accounting/receivables/[id]/page.tsx",
  "apps/web/scripts/verify-accounting-receivables-governance-live.mjs",
  "docs/implementation/stages/STAGE_6_ACCOUNTING_RECEIVABLES_GOVERNANCE.md",
];

for (const file of required) {
  assert.ok(fs.existsSync(file), `${file} is missing`);
}

const service = fs.readFileSync(
  "services/api/src/accounting/receivables-governance.js",
  "utf8",
);
for (const symbol of [
  "evaluateReceivableHealth",
  "buildReceivablesGovernanceSummary",
  "getReceivablesGovernanceDashboard",
  "assessCustomerInvoiceReadiness",
  "captureReceivablesGovernanceSnapshot",
  "getCustomerInvoiceGovernanceTimeline",
  "listReceivablesSavedViews",
  "saveReceivablesView",
  "deleteReceivablesSavedView",
  "upsertReceivablesCollectionCase",
  "bulkManageReceivablesCollections",
  "refreshReceivablesAging",
]) {
  assert.match(service, new RegExp(`export (async )?function ${symbol}`));
}

const declarations = fs.readFileSync(
  "services/api/src/accounting/receivables-governance.d.ts",
  "utf8",
);
for (const symbol of [
  "getReceivablesGovernanceDashboard",
  "assessCustomerInvoiceReadiness",
  "captureReceivablesGovernanceSnapshot",
  "upsertReceivablesCollectionCase",
  "bulkManageReceivablesCollections",
]) {
  assert.match(declarations, new RegExp(`export function ${symbol}`));
}

const accountingIndex = fs.readFileSync(
  "services/api/src/accounting/index.js",
  "utf8",
);
assert.match(accountingIndex, /receivables-governance\.js/);

const migration = fs.readFileSync(
  "database/tenant/migrations/022_accounting_receivables_governance.sql",
  "utf8",
);
for (const table of [
  "accounting_receivables_governance_policies",
  "accounting_receivables_saved_views",
  "accounting_receivables_governance_snapshots",
  "accounting_collection_cases",
]) {
  assert.match(migration, new RegExp(`tenant\\.${table}`));
}
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
assert.match(migration, /tenant_organization_isolation/);

const actions = fs.readFileSync(
  "apps/web/src/app/api/accounting/receivables/invoices/[id]/actions/route.ts",
  "utf8",
);
assert.match(actions, /captureReceivablesGovernanceSnapshot/);

const operations = fs.readFileSync(
  "apps/web/src/app/api/accounting/receivables/operations/route.ts",
  "utf8",
);
assert.match(operations, /bulkManageReceivablesCollections/);
assert.match(operations, /refreshReceivablesAging/);

const listPage = fs.readFileSync(
  "apps/web/src/app/(app)/accounting/receivables/page.tsx",
  "utf8",
);
assert.match(listPage, /getReceivablesGovernanceDashboard/);

const detailPage = fs.readFileSync(
  "apps/web/src/app/(app)/accounting/receivables/[id]/page.tsx",
  "utf8",
);
assert.match(detailPage, /assessCustomerInvoiceReadiness/);
assert.match(detailPage, /getCustomerInvoiceGovernanceTimeline/);

const receivablesEngine = fs.readFileSync(
  "services/api/src/accounting/receivables.js",
  "utf8",
);
for (const existingCapability of [
  "createCustomerInvoice",
  "postCustomerInvoice",
  "createCustomerReceipt",
  "allocateCustomerReceipt",
  "applyCustomerCreditNote",
]) {
  assert.match(
    receivablesEngine,
    new RegExp(`export async function ${existingCapability}`),
  );
}

const advancedAccounting = fs.readFileSync(
  "services/api/src/accounting/advanced.js",
  "utf8",
);
assert.match(advancedAccounting, /export async function runDunning/);

const mobileParity = fs.readFileSync(
  "apps/mobile/src/core/modules/web-parity.ts",
  "utf8",
);
assert.match(mobileParity, /web: "\/accounting\/receivables"/);
assert.match(mobileParity, /web: "\/accounting\/receivables\/\[id\]"/);
assert.match(mobileParity, /web: "\/accounting\/receivables\/new"/);

console.log("Stage 6 Accounting receivables governance contract verified.");
