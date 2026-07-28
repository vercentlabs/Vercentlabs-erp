import { createPageMetadata } from "@/lib/metadata";

import StructuredContentPage, {
  type StructuredPageConfig,
} from "@/components/marketing/structured-content-page";

export const metadata = createPageMetadata({
  title: "Vercentlabs ERP Product | Four Released Business Modules",
  description:
    "Review the released Vercentlabs CRM, Sales, Accounting and Procurement scope, with eight future ERP modules clearly separated as roadmap.",
  path: "/product",
});

const config: StructuredPageConfig = {
  hero: {
    eyebrow: "Current product boundary",
    title: "Four governed business modules on one operating foundation.",
    description:
      "Vercentlabs ERP currently delivers identity, organisation context, permissions, governed business data, approvals, audit history and billing controls with CRM, Sales, Accounting and Procurement released end to end. Eight operational modules remain explicit roadmap scope.",
    primary: { label: "Book a released-scope demo", href: "/book-demo" },
    secondary: { label: "Inspect all released features", href: "/features" },
  },
  sections: [
    {
      eyebrow: "Released CRM",
      title: "Run the customer lifecycle from capture to governed decision.",
      paragraphs: [
        "Capture, qualify, assign and convert leads; manage opportunities, activities, campaigns, consent, reports and the native CRM client.",
        "Supported opportunity stage changes and activity completion can move through transactional approvals with permission checks, separation of duties and immutable decision history.",
      ],
      bullets: [
        "Lead capture, duplicate controls and deterministic scoring",
        "Lead conversion into partner, contact and opportunity records",
        "Opportunity pipeline, forecasting and stage history",
        "Activities, campaigns, privacy controls and provider-safe outbox delivery",
        "Dashboards, exports, mobile workflows and offline-safe mutations",
      ],
    },
    {
      eyebrow: "Released Sales",
      title: "Control quotation-to-order and downstream handoffs.",
      paragraphs: [
        "Create versioned quotations with pricing, tax, margin and approval evidence; collect secure customer decisions; convert accepted quotations exactly once into governed sales orders.",
        "Confirm, hold, amend and cancel orders while preserving schedules, fulfilment requests, invoice requests, version history and idempotent handoffs.",
      ],
    },
    {
      eyebrow: "Released Accounting",
      title: "Operate the ledger, subledgers, banking, tax and close.",
      tone: "dark",
      paragraphs: [
        "Maintain chart of accounts, journals, receivables, payables, payments, allocations, banking, GST, assets, accruals, recurring entries, budgets, forecasts, foreign-exchange revaluation, intercompany and consolidation controls.",
        "Run governed period close and financial reports with balanced posting, immutable evidence, reversals, dimensions and restricted database access.",
      ],
    },
    {
      eyebrow: "Released Procurement",
      title: "Run source-to-pay controls from supplier through matching.",
      paragraphs: [
        "Manage supplier onboarding and qualification, requisitions, sourcing events, bid evaluation and award, agreements, purchase orders, amendments, receipts, services, returns and invoice matching.",
        "Apply two-, three- or four-way matching, tolerance policies, exception records, separation of duties, supplier performance reporting, audit events and retryable integration outbox delivery.",
      ],
    },
    {
      eyebrow: "Implemented foundation",
      title: "Keep identity, context and evidence consistent underneath every module.",
      tone: "dark",
      items: [
        {
          title: "Account and organisation lifecycle",
          description:
            "Registration, verified email, sessions, recovery, companies, branches, teams, cost centres and active operating context are governed centrally.",
        },
        {
          title: "Permission enforcement",
          description:
            "Navigation, APIs, commands and PostgreSQL row-level security enforce role, organisation, company and branch boundaries.",
        },
        {
          title: "Governed master data",
          description:
            "Business partners, contacts, items, warehouses, currencies, payment terms and tax setup provide shared records for released modules.",
        },
        {
          title: "Audit, approvals and notifications",
          description:
            "Security events, business changes, decisions and role-scoped notifications retain traceable user, version and command evidence.",
        },
        {
          title: "Commercial and operational controls",
          description:
            "Organisation-level trials, entitlements, usage, billing, provider credentials, retries and release gates fail closed until configured.",
        },
      ],
    },
    {
      eyebrow: "Roadmap — not released",
      title: "Eight modules remain visible product direction, not current functionality.",
      paragraphs: [
        "Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support and HR & Payroll cannot be activated in the current release.",
        "Each module will become available only after its records, permissions, workflows, approvals, reporting, migrations, web experience, required mobile scope and acceptance evidence are complete.",
      ],
      cta: { label: "Review the transparent module map", href: "/modules" },
    },
  ],
  finalCta: {
    title: "Evaluate the released workflows with real operating evidence.",
    description:
      "Bring real users, records, permission boundaries, exceptions and measurable acceptance criteria. The demo will stay inside released scope.",
    primary: { label: "Book a released-scope demo", href: "/book-demo" },
    secondary: { label: "Open the module roadmap", href: "/modules" },
  },
};

export default function ProductPage() {
  return <StructuredContentPage config={config} />;
}
