import { createPageMetadata } from "@/lib/metadata";

import StructuredContentPage, {
  type ContentItem,
  type StructuredPageConfig,
} from "@/components/marketing/structured-content-page";

export const metadata = createPageMetadata({
  title: "Vercentlabs ERP Features | CRM, Sales and Accounting",
  description:
    "Explore the released Vercentlabs ERP CRM, Sales and Accounting capabilities, with nine additional ERP modules clearly separated as roadmap scope.",
  path: "/features",
});

const items = (entries: Array<[string, string]>): ContentItem[] =>
  entries.map(([title, description]) => ({ title, description }));

const config: StructuredPageConfig = {
  hero: {
    eyebrow: "Released early-access scope",
    title: "Governed CRM, Sales and Accounting workflows on one ERP foundation.",
    description:
      "The current release covers authentication, organisation administration, permissions, shared master data, auditability, billing controls, governed approvals, CRM, Sales and Accounting. The remaining nine ERP modules are roadmap items and cannot be activated in this release.",
    primary: { label: "Book an ERP walkthrough", href: "/contact" },
    secondary: { label: "Review the module roadmap", href: "/modules" },
  },
  sections: [
    {
      title: "Platform foundation",
      items: items([
        [
          "Account lifecycle",
          "Register, verify email, sign in, recover passwords, change passwords, revoke sessions and sign out through protected flows.",
        ],
        [
          "Organisation onboarding",
          "Create the organisation, primary company, branch, operating context, default roles, numbering and CRM configuration without manual SQL.",
        ],
        [
          "Organisation administration",
          "Maintain companies, branches, departments, teams, cost centres, users, invitations and operating access.",
        ],
        [
          "Role-based permissions",
          "Enforce organisation, company, branch, role and action boundaries in navigation, APIs and PostgreSQL row-level security.",
        ],
        [
          "Audit and notifications",
          "Record immutable security and business events while routing role-scoped notifications to the relevant workspace.",
        ],
        [
          "Governed approvals",
          "Request and decide supported CRM stage-change and activity-completion commands with version checks, separation of duties and transactional execution.",
        ],
      ]),
    },
    {
      title: "Shared business data",
      tone: "dark",
      items: items([
        [
          "Business partners and contacts",
          "Maintain reusable customer, supplier and contact records on the tenant-safe business-data foundation.",
        ],
        [
          "Items and classifications",
          "Manage items, groups, units of measure and the shared records future operational modules will consume.",
        ],
        [
          "Warehouse and finance setup",
          "Prepare warehouses, currencies, payment terms and tax configuration while keeping roadmap inventory transactions clearly separated.",
        ],
        [
          "Governed import and export",
          "Import valid rows with per-row recovery, export permission-scoped CSV and neutralise spreadsheet formulas.",
        ],
        [
          "Scoped search",
          "Find permitted companies, branches, users, CRM records and master data without crossing organisation boundaries.",
        ],
        [
          "Reusable platform contracts",
          "Keep database, permissions, document, reporting, workflow and shared-client contracts ready for later modules.",
        ],
      ]),
    },
    {
      title: "CRM lifecycle",
      items: items([
        [
          "Lead capture",
          "Create leads from staff entry, governed CSV import and signed public forms with origin, abuse and duplicate controls.",
        ],
        [
          "Qualification and assignment",
          "Apply configurable sources, campaigns, tags, scoring, duplicate detection and fixed or round-robin ownership.",
        ],
        [
          "Replay-safe conversion",
          "Convert a qualified lead into business-partner, contact and opportunity records exactly once while preserving history.",
        ],
        [
          "Opportunity pipeline",
          "Manage configurable stages, probability, forecast category, expected close, win or loss state and stage history.",
        ],
        [
          "Activities and engagement",
          "Schedule and complete tasks, calls, meetings and follow-ups while keeping provider-neutral communication history.",
        ],
        [
          "Campaigns and automation",
          "Manage campaigns, sequences, automation rules and a consent-aware outbox with retries and dead-letter handling.",
        ],
      ]),
    },
    {
      title: "Sales order-to-cash",
      items: items([
        [
          "Versioned quotations",
          "Create governed quotations from CRM opportunities with deterministic pricing, tax traces, approvals, secure customer decisions and immutable revisions.",
        ],
        [
          "Sales orders",
          "Convert accepted quotations exactly once, confirm commercial terms, track schedules, holds, amendments, fulfilment status and billing readiness.",
        ],
        [
          "Inventory and accounting handoffs",
          "Send durable idempotent fulfilment and invoice requests without posting stock or ledgers from the Sales boundary.",
        ],
      ]),
    },
    {
      title: "Accounting and financial control",
      tone: "dark",
      items: items([
        [
          "General ledger and periods",
          "Maintain a configurable chart of accounts, balanced journals, immutable postings, reversals, dimensions and governed fiscal-period close controls.",
        ],
        [
          "Receivables and payables",
          "Post customer invoices from Sales handoffs, manage supplier bills, receipts, payments, allocations, matching, aging and statements.",
        ],
        [
          "Banking, tax and assets",
          "Reconcile statements, calculate GST components, operate compliance queues, depreciate assets and preserve complete accounting evidence.",
        ],
        [
          "Planning and reporting",
          "Run budgets, forecasts, revaluations, intercompany and consolidation workflows with trial balance, P&L, balance sheet and cash-flow reporting.",
        ],
      ]),
    },
    {
      title: "Visibility, mobile and commercial controls",
      items: items([
        [
          "CRM dashboards and reports",
          "Review tenant-scoped pipeline, conversion, source, activity, forecast, campaign, privacy and advanced CRM reports.",
        ],
        [
          "Privacy and data quality",
          "Maintain consent evidence, privacy requests, data-quality records and audited sensitive actions.",
        ],
        [
          "Native CRM client",
          "Use permission-safe Android and iOS workspaces with bearer authentication, encrypted offline data and queued supported mutations.",
        ],
        [
          "Billing entitlements",
          "Control plan capacity, module availability, usage and billing access at organisation level rather than per user.",
        ],
        [
          "Provider-safe integrations",
          "Keep payment and communication adapters fail-closed until credentials, consent evidence and operational acceptance are configured.",
        ],
        [
          "Release verification",
          "Run locked dependency, test, migration, database, build, readiness and deployment checks before promotion.",
        ],
      ]),
    },
    {
      eyebrow: "Clearly separated roadmap",
      title: "Nine modules remain future scope.",
      paragraphs: [
        "Procurement, Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support and HR & Payroll are registered as roadmap modules only.",
        "They cannot be enabled through the current UI or API. Each will be released later only after its records, workflows, approvals, reporting, permissions, tests and migration path are complete end to end.",
      ],
    },
  ],
  finalCta: {
    title:
      "Evaluate the released CRM, Sales and Accounting workflows end to end.",
    description:
      "Use a complete lead-to-opportunity, quotation-to-order and invoice-to-ledger scenario with real roles, permission denials, reports and approval decisions.",
    primary: { label: "Book an ERP walkthrough", href: "/contact" },
    secondary: { label: "Explore the module roadmap", href: "/modules" },
  },
};

export default function FeaturesPage() {
  return <StructuredContentPage config={config} />;
}
