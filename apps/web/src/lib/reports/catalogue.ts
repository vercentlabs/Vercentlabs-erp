// Prompt 10 (Administration Foundation) — a typed catalogue of REAL
// existing report destinations only (Part 27: "Do not invent report
// routes"). Confirmed by direct audit: only 4 of the 12 business modules
// have an actual hand-coded reports implementation (CRM, Sales,
// Procurement, Accounting) — the other 8 modules' `xxxReportsView`
// permission exists in the catalogue but has no report behind it, so no
// entry is created for them here. Every module here renders ALL of its
// named reports on one shared page (no per-report sub-route exists), so
// several catalogue entries intentionally point at the same `route` —
// that route is the real, honest destination for each.
import type { ModuleId } from "@/lib/navigation/types";
import { PERMISSIONS } from "@/lib/permissions-catalog";

export type ReportCatalogueEntry = {
  key: string;
  label: string;
  moduleId: ModuleId;
  route: string;
  /** The permission that gates the report's own module report page (not a per-report sub-permission unless noted). */
  permission: string;
  description: string;
};

export const REPORT_CATALOGUE: ReportCatalogueEntry[] = [
  // CRM — /crm/reports renders all of these on one page.
  ...[
    ["pipeline", "Pipeline", "Open opportunity pipeline value by stage."],
    ["conversion", "Conversion", "Lead-to-opportunity and stage conversion rates."],
    ["sources", "Sources", "Lead volume and quality by source."],
    ["activities", "Activities", "Activity volume and completion by owner."],
    ["forecast", "Forecast", "Weighted pipeline forecast by period and category."],
    ["campaigns", "Campaigns", "Campaign response and pipeline contribution."],
    ["revenue-operations", "Revenue operations", "Cross-team revenue-operations metrics."],
    ["account-health", "Account health", "Account engagement and risk signals."],
    ["privacy", "Privacy", "Consent, retention and privacy-request status."],
    ["pipeline-intelligence", "Pipeline intelligence", "Deal-risk and momentum signals."],
    ["engagement-intelligence", "Engagement intelligence", "Communication engagement patterns."],
    ["relationship-coverage", "Relationship coverage", "Buying-committee and stakeholder coverage."],
    ["partner-pipeline", "Partner pipeline", "Partner-sourced and co-sold pipeline."],
    ["ai-governance", "AI governance", "AI-assisted action review and override status."],
  ].map(([key, label, description]) => ({
    key: `crm.${key}`,
    label,
    moduleId: "crm" as ModuleId,
    route: "/crm/reports",
    permission: PERMISSIONS.crmReportsView,
    description,
  })),
  // Sales — /sales/reports renders all of these on one page. "Margin"
  // additionally requires salesMarginView inside the report handler
  // itself (services/api/src/sales/index.js) — noted in its description
  // rather than a second permission field, since the catalogue's own
  // gate is still the page-level salesReportsView.
  ...[
    ["quotation-conversion", "Quotation conversion", "Quotation-to-order conversion rates."],
    ["order-intake", "Order intake", "Sales order intake volume and value."],
    ["expiring-quotations", "Expiring quotations", "Quotations approaching their validity deadline."],
    ["pending-approvals", "Pending approvals", "Sales documents awaiting approval."],
    ["active-holds", "Active holds", "Orders currently on hold."],
    ["fulfillment", "Fulfillment", "Order fulfillment status and delays."],
    ["billing-readiness", "Billing readiness", "Orders ready for invoicing."],
    ["customer-performance", "Customer performance", "Revenue and order trends by customer."],
    ["margin", "Margin (requires margin visibility)", "Order margin by customer/item — requires sales.margin.view in addition to report access."],
  ].map(([key, label, description]) => ({
    key: `sales.${key}`,
    label,
    moduleId: "sales" as ModuleId,
    route: "/sales/reports",
    permission: PERMISSIONS.salesReportsView,
    description,
  })),
  // Procurement — /procurement/reports renders all of these on one page.
  ...[
    ["spend-analysis", "Spend analysis", "Procurement spend by category and supplier."],
    ["supplier-performance", "Supplier performance", "Supplier scorecards and delivery performance."],
    ["purchase-price-variance", "Purchase price variance", "Price variance against standard/contracted cost."],
    ["contract-compliance", "Contract compliance", "Spend against contracted agreements."],
    ["maverick-spend", "Maverick spend", "Spend outside approved suppliers/contracts."],
  ].map(([key, label, description]) => ({
    key: `procurement.${key}`,
    label,
    moduleId: "procurement" as ModuleId,
    route: "/procurement/reports",
    permission: PERMISSIONS.procurementReportsView,
    description,
  })),
  // Accounting — /accounting/reports renders all of these on one page.
  ...[
    ["trial-balance", "Trial balance", "Period trial balance by account."],
    ["general-ledger", "General ledger", "Posted journal-line detail by account."],
    ["journal-register", "Journal register", "Journal entries by status and period."],
    ["profit-and-loss", "Profit and loss", "Income and expense by period."],
    ["balance-sheet", "Balance sheet", "Assets, liabilities and equity as of a date."],
    ["cash-flow", "Cash flow", "Realized cash movement by period."],
    ["aged-receivables", "Aged receivables", "Customer receivables by ageing bucket."],
    ["aged-payables", "Aged payables", "Vendor payables by ageing bucket."],
    ["customer-statement", "Customer statement", "Open items and activity for one customer."],
    ["supplier-statement", "Supplier statement", "Open items and activity for one supplier."],
    ["tax-summary", "Tax summary", "Tax collected/paid by period."],
    ["bank-reconciliation", "Bank reconciliation", "Reconciliation status by bank account."],
    ["budget-vs-actual", "Budget vs actual", "Budget variance by account/period."],
    ["cash-flow-forecast", "Cash flow forecast", "Projected cash position."],
    ["foreign-currency-exposure", "Foreign currency exposure", "Open exposure by currency."],
  ].map(([key, label, description]) => ({
    key: `accounting.${key}`,
    label,
    moduleId: "accounting" as ModuleId,
    route: "/accounting/reports",
    permission: PERMISSIONS.accountingReportsView,
    description,
  })),
];

// The 8 modules with a real `xxxReportsView` permission but no report
// implementation behind it — confirmed by direct audit. Documented, not
// hidden, and never rendered as a working destination (Part 22 of the
// documentation template covers this explicitly).
export const MODULES_WITHOUT_REPORTS: ModuleId[] = [
  "stock",
  "manufacturing",
  "projects",
  "assets",
  "point-of-sale",
  "quality",
  "support",
  "hr-payroll",
];
