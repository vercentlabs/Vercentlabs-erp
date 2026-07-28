import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const resolve = (relative) => path.resolve(root, relative);
const read = (relative) => fs.readFileSync(resolve(relative), "utf8");

const requiredPaths = [
  "src/app/(app)/accounting/page.tsx",
  "src/app/(app)/accounting/journals/page.tsx",
  "src/app/(app)/accounting/journals/new/page.tsx",
  "src/app/(app)/accounting/journals/[id]/page.tsx",
  "src/app/(app)/accounting/receivables/page.tsx",
  "src/app/(app)/accounting/receivables/[id]/page.tsx",
  "src/app/(app)/accounting/payables/page.tsx",
  "src/app/(app)/accounting/payables/[id]/page.tsx",
  "src/app/(app)/accounting/banking/page.tsx",
  "src/app/(app)/accounting/assets/page.tsx",
  "src/app/(app)/accounting/planning/page.tsx",
  "src/app/(app)/accounting/tax/page.tsx",
  "src/app/(app)/accounting/operations/page.tsx",
  "src/app/(app)/accounting/close/page.tsx",
  "src/app/(app)/accounting/close/[id]/page.tsx",
  "src/app/(app)/accounting/reports/page.tsx",
  "src/app/(app)/accounting/settings/page.tsx",
  "src/components/accounting/journal-editor.tsx",
  "src/components/accounting/subledger-document-editor.tsx",
  "src/components/accounting/budget-editor.tsx",
  "src/components/accounting/recurring-editor.tsx",
  "src/components/accounting/vendor-match-form.tsx",
  "src/components/accounting/accounting-policy-editor.tsx",
  "src/components/accounting/close-task-actions.tsx",
  "src/lib/accounting.ts",
  "src/lib/accounting-route.ts",
  "src/lib/accounting-validation.ts",
  "src/app/api/accounting/journals/route.ts",
  "src/app/api/accounting/receivables/invoices/route.ts",
  "src/app/api/accounting/payables/bills/route.ts",
  "src/app/api/accounting/payables/bills/[id]/matching/route.ts",
  "src/app/api/accounting/payables/procurement-matches/[id]/import/route.ts",
  "src/app/api/accounting/banking/statements/route.ts",
  "src/app/api/accounting/compliance/requests/route.ts",
  "src/app/api/accounting/forecasts/route.ts",
  "src/app/api/accounting/forecasts/[id]/generate/route.ts",
  "src/app/api/accounting/close/[id]/actions/route.ts",
  "src/app/api/accounting/reports/[report]/route.ts",
  "../../database/control-plane/migrations/013_accounting_module_release.sql",
  "../../database/tenant/migrations/009_accounting_module.sql",
  "../../database/tenant/migrations/010_accounting_advanced.sql",
  "../../database/tenant/migrations/011_accounting_integrity_and_compliance.sql",
  "../../services/api/src/accounting/index.js",
  "../../services/api/src/accounting/foundation.js",
  "../../services/api/src/accounting/journals.js",
  "../../services/api/src/accounting/receivables.js",
  "../../services/api/src/accounting/payables.js",
  "../../services/api/src/accounting/banking.js",
  "../../services/api/src/accounting/close.js",
  "../../services/api/src/accounting/assets.js",
  "../../services/api/src/accounting/accruals.js",
  "../../services/api/src/accounting/advanced.js",
  "../../services/api/src/accounting/reports.js",
  "../../services/api/src/accounting/tax.js",
  "../../services/api/src/accounting/schedules.js",
  "../../services/api/src/accounting/matching.js",
  "../../services/api/src/accounting/compliance.js",
  "../../services/api/src/accounting/forecast.js",
  "../../services/api/src/accounting/settlements.js",
  "../../services/api/src/accounting/subledger-approvals.js",
  "../../packages/permissions/src/accounting.js",
  "../../packages/shared-types/src/accounting.js",
  "../../packages/shared-sdk/src/accounting.js",
  "../../docs/architecture/accounting-module.md",
  "../../docs/runbooks/accounting-operations.md",
  "../../docs/checklists/accounting-release-checklist.md",
];

const missing = requiredPaths.filter((relative) => !fs.existsSync(resolve(relative)));
if (missing.length) throw new Error(`Missing Accounting paths: ${missing.join(", ")}`);

const migrations = [
  "../../database/tenant/migrations/009_accounting_module.sql",
  "../../database/tenant/migrations/010_accounting_advanced.sql",
  "../../database/tenant/migrations/011_accounting_integrity_and_compliance.sql",
].map(read).join("\n");
const migrationMarkers = [
  "accounting_settings",
  "accounting_ledgers",
  "accounting_accounts",
  "accounting_journals",
  "accounting_journal_entries",
  "accounting_journal_lines",
  "accounting_customer_invoices",
  "accounting_customer_receipts",
  "accounting_vendor_bills",
  "accounting_vendor_payments",
  "accounting_bank_statements",
  "accounting_reconciliations",
  "accounting_tax_ledger",
  "accounting_tax_returns",
  "accounting_asset_depreciation_schedule",
  "accounting_recurring_templates",
  "accounting_accrual_schedules",
  "accounting_revaluation_runs",
  "accounting_budgets",
  "accounting_close_runs",
  "accounting_intercompany_rules",
  "accounting_consolidation_runs",
  "accounting_vendor_bill_matches",
  "accounting_compliance_requests",
  "accounting_cash_forecast_scenarios",
  "accounting_cash_forecast_lines",
  "customer_invoice_approval_required",
  "vendor_bill_approval_required",
  "vendor_payment_approval_required",
  "accounting_allocations_append_only",
  "entry_type IN ('standard','opening','closing','adjustment','accrual','deferral','recurring','asset'",
  "FORCE ROW LEVEL SECURITY",
  "Posted accounting entries are immutable",
  "Journal entry is not balanced: debit %, credit %",
];
for (const marker of migrationMarkers) {
  if (!migrations.includes(marker)) throw new Error(`Accounting migrations are missing ${marker}`);
}

const serviceFiles = fs.readdirSync(resolve("../../services/api/src/accounting"))
  .filter((name) => name.endsWith(".js"))
  .map((name) => read(`../../services/api/src/accounting/${name}`))
  .join("\n");
const serviceMarkers = [
  "initializeAccountingCompany",
  "createJournalEntry",
  "postJournalEntry",
  "reverseJournalEntry",
  "createInvoiceFromSalesRequest",
  "postCustomerInvoice",
  "allocateCustomerReceipt",
  "postVendorBill",
  "importProcurementMatchAsVendorBill",
  "accounting.vendor_bill.imported_from_procurement",
  "allocateVendorPayment",
  "evaluateVendorBillMatch",
  "overrideVendorBillMatch",
  "completeBankReconciliation",
  "createTaxReturn",
  "createComplianceRequest",
  "updateComplianceRequest",
  "postAssetDepreciation",
  "runDueRecurringTemplates",
  "runDueAccruals",
  "calculateRevaluation",
  "createBudget",
  "createCashForecastScenario",
  "generateCashForecast",
  "createCloseRun",
  "getPeriodCloseBlockers",
  "completeCloseRun",
  "createIntercompanyJournal",
  "calculateConsolidation",
  "submitSubledgerDocument",
  "approveSubledgerDocument",
  "createCustomerSettlementAdjustment",
  "createVendorSettlementAdjustment",
  "getAccountingReport",
  '"cash-flow-forecast"',
  '"close-status"',
];
for (const marker of serviceMarkers) {
  if (!serviceFiles.includes(marker)) throw new Error(`Accounting services are missing ${marker}`);
}

const DOUBLE_ENTRY = migrations.includes("Journal entry is not balanced: debit %, credit %") &&
  migrations.includes("Posted accounting entries are immutable") &&
  migrations.includes("accounting_allocations_append_only");
if (!DOUBLE_ENTRY) throw new Error("Double-entry, immutability and append-only protections are incomplete.");

const control = read("../../database/control-plane/migrations/013_accounting_module_release.sql");
for (const marker of [
  "accounting.journal.post",
  "accounting.receivables.manage",
  "accounting.receivables.approve",
  "accounting.payables.manage",
  "accounting.payables.approve",
  "accounting.payments.approve",
  "accounting.bank.reconcile",
  "accounting.period.manage",
  "accounting.tax.manage",
  "accounting.assets.manage",
  "accounting.consolidation.manage",
  "accounting_compliance_request",
  "accounting_cash_forecast",
  "'accounting', 'Accounting', 'enabled'",
]) {
  if (!control.includes(marker)) throw new Error(`Accounting release migration is missing ${marker}`);
}

const readiness = read("src/app/api/readiness/route.ts");
if (!readiness.includes('"011_accounting_integrity_and_compliance.sql"')) {
  throw new Error("Readiness does not require the latest Accounting tenant migration.");
}

console.log(`Accounting module verified across ${requiredPaths.length} permanent paths.`);
