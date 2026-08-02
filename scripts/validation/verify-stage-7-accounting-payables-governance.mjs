import assert from "node:assert/strict";
import fs from "node:fs";

const required = [
  "services/api/src/accounting/payables-governance.js",
  "services/api/src/accounting/payables-governance.d.ts",
  "services/api/tests/accounting-payables-governance-stage7.test.mjs",
  "database/tenant/migrations/023_accounting_payables_governance.sql",
  "apps/web/src/app/api/accounting/payables/operations/route.ts",
  "apps/web/src/app/(app)/accounting/payables/page.tsx",
  "apps/web/src/app/(app)/accounting/payables/[id]/page.tsx",
  "apps/web/scripts/verify-accounting-payables-governance-live.mjs",
  "docs/implementation/stages/STAGE_7_ACCOUNTING_PAYABLES_GOVERNANCE.md",
];

for (const file of required) {
  assert.ok(fs.existsSync(file), `${file} is missing`);
}

const service = fs.readFileSync(
  "services/api/src/accounting/payables-governance.js",
  "utf8",
);
for (const symbol of [
  "evaluatePayableHealth",
  "buildPayablesGovernanceSummary",
  "getPayablesGovernanceDashboard",
  "assessVendorBillReadiness",
  "capturePayablesGovernanceSnapshot",
  "getVendorBillGovernanceTimeline",
  "listPayablesSavedViews",
  "savePayablesView",
  "deletePayablesSavedView",
  "upsertPayablesExceptionCase",
  "bulkManagePayablesExceptions",
  "listVendorPaymentProposals",
  "createVendorPaymentProposal",
  "changeVendorPaymentProposalStatus",
  "prepareVendorPaymentsFromProposal",
  "refreshPayablesAging",
]) {
  assert.match(service, new RegExp(`export (async )?function ${symbol}`));
}

const declarations = fs.readFileSync(
  "services/api/src/accounting/payables-governance.d.ts",
  "utf8",
);
for (const symbol of [
  "getPayablesGovernanceDashboard",
  "assessVendorBillReadiness",
  "capturePayablesGovernanceSnapshot",
  "upsertPayablesExceptionCase",
  "createVendorPaymentProposal",
  "prepareVendorPaymentsFromProposal",
]) {
  assert.match(declarations, new RegExp(`export function ${symbol}`));
}

const accountingIndex = fs.readFileSync(
  "services/api/src/accounting/index.js",
  "utf8",
);
assert.match(accountingIndex, /payables-governance\.js/);

const migration = fs.readFileSync(
  "database/tenant/migrations/023_accounting_payables_governance.sql",
  "utf8",
);
for (const table of [
  "accounting_payables_governance_policies",
  "accounting_payables_saved_views",
  "accounting_payables_governance_snapshots",
  "accounting_payables_exception_cases",
  "accounting_vendor_payment_proposals",
  "accounting_vendor_payment_proposal_items",
]) {
  assert.match(migration, new RegExp(`tenant\\.${table}`));
}
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
assert.match(migration, /tenant_organization_isolation/);

const actions = fs.readFileSync(
  "apps/web/src/app/api/accounting/payables/bills/[id]/actions/route.ts",
  "utf8",
);
assert.match(actions, /capturePayablesGovernanceSnapshot/);

const matching = fs.readFileSync(
  "apps/web/src/app/api/accounting/payables/bills/[id]/matching/route.ts",
  "utf8",
);
assert.match(matching, /capturePayablesGovernanceSnapshot/);

const operations = fs.readFileSync(
  "apps/web/src/app/api/accounting/payables/operations/route.ts",
  "utf8",
);
assert.match(operations, /createVendorPaymentProposal/);
assert.match(operations, /prepareVendorPaymentsFromProposal/);
assert.match(operations, /bulkManagePayablesExceptions/);

const listPage = fs.readFileSync(
  "apps/web/src/app/(app)/accounting/payables/page.tsx",
  "utf8",
);
assert.match(listPage, /getPayablesGovernanceDashboard/);

const detailPage = fs.readFileSync(
  "apps/web/src/app/(app)/accounting/payables/[id]/page.tsx",
  "utf8",
);
assert.match(detailPage, /assessVendorBillReadiness/);
assert.match(detailPage, /getVendorBillGovernanceTimeline/);

const payablesEngine = fs.readFileSync(
  "services/api/src/accounting/payables.js",
  "utf8",
);
for (const existingCapability of [
  "createVendorBill",
  "postVendorBill",
  "createVendorPayment",
  "allocateVendorPayment",
  "applyVendorCreditNote",
  "importProcurementMatchAsVendorBill",
]) {
  assert.match(
    payablesEngine,
    new RegExp(`export async function ${existingCapability}`),
  );
}

const matchingEngine = fs.readFileSync(
  "services/api/src/accounting/matching.js",
  "utf8",
);
assert.match(matchingEngine, /export async function evaluateVendorBillMatch/);
assert.match(matchingEngine, /export async function overrideVendorBillMatch/);

const mobileParity = fs.readFileSync(
  "apps/mobile/src/core/modules/web-parity.ts",
  "utf8",
);
assert.match(mobileParity, /web: "\/accounting\/payables"/);
assert.match(mobileParity, /web: "\/accounting\/payables\/\[id\]"/);
assert.match(mobileParity, /web: "\/accounting\/payables\/new"/);

console.log("Stage 7 Accounting payables governance contract verified.");
