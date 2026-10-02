import { CTAS } from "../navigation.js";
import { capabilityGroup } from "./capability-group.js";
import { PLATFORM_GOVERNANCE } from "./platform-governance.js";

/**
 * Accounting — marketing content for the `accounting` module of the ERP
 * module catalog (@vercentlabs/shared-types). The catalog owns `key`, `name`,
 * and `description`; `displayName` is the public label. Everything here must
 * stay inside this module's approved launch capabilities
 * (capabilities/launch-capabilities.js).
 */
export const ACCOUNTING_MODULE = Object.freeze({
  key: "accounting",
  displayName: "Accounting",
  purpose: "General ledger, receivables, payables, banking, and financial statements.",
  navGroup: "finance",
  personas: ["Finance managers and controllers", "Accountants", "AR/AP staff", "Auditors"],
  painPoints: [
    "Invoices and bills re-keyed into the books",
    "Bank balances reconciled in spreadsheets",
    "Month-end reports assembled by hand",
  ],
  bestAngle:
    "Customer and supplier invoices post to the general ledger, receipts and payments are allocated and reconciled with the bank, and the trial balance, profit & loss, and balance sheet come from the same double-entry ledger.",
  accentColor: { hex: "#31566f", soft: "#edf4f7", sourcedFromProduct: false },
  directDefinition:
    "The Vercentlabs Accounting module keeps the books — chart of accounts, a double-entry general ledger and journals, fiscal years and periods, receivables and payables posting, receipts, payments, bank and cash reconciliation, GST tax posting, and financial statements.",
  heroVariant: "operational-sequence",
  searchIntent: "Accounting ERP",
  metaDescription:
    "Vercentlabs Accounting runs a double-entry general ledger with receivables and payables posting, receipts, payments, bank reconciliation, GST tax posting, trial balance, P&L, and balance sheet.",
  businessProblems: [
    { title: "Invoices typed twice", description: "Sales invoices and supplier bills are re-entered into a separate accounting tool." },
    { title: "Bank reconciliation in spreadsheets", description: "Receipts and payments are matched to the bank statement by hand." },
    { title: "Reports assembled from exports", description: "The trial balance and statements are rebuilt from several exports every month." },
    { title: "Books that can be changed after the fact", description: "Closed periods are reopened and edited without a trace." },
  ],
  businessOutcomes: [
    { title: "Postings from the source", description: "Customer and supplier invoices post to receivables and payables in the same system they were created in." },
    { title: "Reconciled cash", description: "Receipts and payments are allocated and reconciled against bank and cash accounts." },
    { title: "Statements from the ledger", description: "Trial balance, profit & loss, and balance sheet come straight from the general ledger." },
    { title: "Controlled periods and a full trail", description: "Fiscal years and accounting periods structure the books, and the audit trail records what changed." },
  ],
  capabilityGroups: [
    capabilityGroup(
      "accounting-ledger",
      "Ledger & periods",
      "The chart of accounts, the double-entry general ledger and its journals, and the years and periods they're kept in.",
      ["accounting-chart-of-accounts", "accounting-general-ledger", "accounting-journal-entries", "accounting-double-entry-enforcement", "accounting-fiscal-years", "accounting-accounting-periods"],
    ),
    capabilityGroup(
      "accounting-receivables-payables",
      "Receivables & payables",
      "Customer and supplier invoices posted to the ledger, and the receipts and payments that settle them.",
      ["accounting-customer-invoices", "accounting-customer-receipts", "accounting-supplier-invoices", "accounting-supplier-payments", "accounting-payment-allocation"],
    ),
    capabilityGroup(
      "accounting-banking-tax",
      "Banking & tax",
      "Bank and cash accounts, reconciliation, and GST tax posting.",
      ["accounting-bank-accounts", "accounting-cash-accounts", "accounting-bank-payment-reconciliation", "accounting-gst-tax-posting"],
    ),
    capabilityGroup(
      "accounting-reporting",
      "Financial statements & audit",
      "The trial balance and financial statements, and the audit trail behind them.",
      ["accounting-trial-balance", "accounting-profit-and-loss", "accounting-balance-sheet", "accounting-audit-trail"],
    ),
  ],
  primaryWorkflow: {
    name: "Invoice to Financial Statements",
    trigger: "Sales and purchases create invoices that need to reach the books.",
    steps: [
      { step: "Post", detail: "Customer invoices post to receivables and supplier invoices post to payables, with GST tax posting." },
      { step: "Settle", detail: "Customer receipts and supplier payments are recorded and allocated to invoices." },
      { step: "Reconcile", detail: "Bank and cash accounts are reconciled against the recorded payments." },
      { step: "Report", detail: "The trial balance, profit & loss, and balance sheet are produced from the general ledger." },
    ],
    approvals: [],
    automatedActions: ["Double-entry enforcement on every journal", "GST tax posting from invoice taxes"],
    connectedModuleKeys: ["sales", "procurement"],
    outcome: "Books that tie out — from invoice to trial balance and financial statements.",
  },
  connectedModules: [
    { moduleKey: "sales", relationship: "Sales invoices become customer invoices posted to receivables." },
    { moduleKey: "procurement", relationship: "Matched supplier invoices from Procurement are posted to payables and paid." },
    { moduleKey: "assets", relationship: "The asset register and its depreciation sit alongside the general ledger." },
  ],
  reporting: [
    { name: "Trial balance", measures: "Balances of every ledger account", audience: "Accountants, auditors" },
    { name: "Profit & loss and balance sheet", measures: "Financial performance and position", audience: "Owners, finance managers" },
  ],
  automation: [
    { title: "Double-entry enforcement", description: "Every journal must balance before it posts." },
    { title: "GST tax posting", description: "GST on invoices posts to the configured tax accounts." },
  ],
  governance: [
    { title: "Accounting periods", description: "Fiscal years and accounting periods control when postings can be made." },
    PLATFORM_GOVERNANCE.permissions,
    { title: "Audit trail", description: "Accounting changes are recorded in the audit trail." },
  ],
  implementationConsiderations: [
    "The chart of accounts, fiscal year, and accounting periods are set up before go-live.",
    "Opening balances, open customer and supplier invoices, and bank accounts are loaded and reconciled.",
    "GST tax configuration is set up with your accountant before the first invoice is posted.",
  ],
  faqs: [
    { question: "Do sales and supplier invoices post to the ledger automatically?", answer: "Customer invoices post to receivables and supplier invoices post to payables in the general ledger, with GST tax posting." },
    { question: "Can we produce a trial balance, P&L, and balance sheet?", answer: "Yes. All three are produced from the double-entry general ledger." },
    { question: "Does Vercentlabs Accounting include consolidation or budgeting?", answer: "No. The launch product covers the general ledger, receivables, payables, banking, GST tax posting, and financial statements; consolidation, intercompany accounting, and budgeting are not part of it." },
  ],
  screenshots: { primary: "accounting-customer-invoices", secondary: "accounting-trial-balance" },
  conversion: { heading: "See how Vercentlabs Accounting would keep your books from invoice to balance sheet.", ctaLabel: CTAS.talkToSpecialist.label },
});
