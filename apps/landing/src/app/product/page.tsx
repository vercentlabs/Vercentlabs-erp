import { createPageMetadata } from "@/lib/metadata";

import StructuredContentPage, {
  type StructuredPageConfig,
} from "@/components/marketing/structured-content-page";

export const metadata = createPageMetadata({
  title: "Vercentlabs ERP Product | Four Released Business Modules",
  description:
    "Review the controlled early-access Vercentlabs CRM, Sales, Accounting and Procurement scope, with incomplete and roadmap capabilities clearly separated.",
  path: "/product",
});

const config: StructuredPageConfig = {
  hero: {
    eyebrow: "Current product boundary",
    title: "Four governed business modules on one operating foundation.",
    description:
      "Vercentlabs ERP currently provides a governed platform foundation with selected controlled early-access workflows across CRM, Sales, Accounting and Procurement. This is not a claim that every benchmarked enterprise capability is complete; eight additional modules remain roadmap scope.",
    primary: { label: "Book a released-scope demo", href: "/book-demo" },
    secondary: { label: "Inspect all released features", href: "/features" },
  },
  sections: [
    {
      eyebrow: "Early-access CRM",
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
      eyebrow: "Early-access Sales",
      title: "Control quotation-to-order and downstream handoffs.",
      paragraphs: [
        "Create versioned quotations with pricing, tax, margin and approval evidence; collect secure customer decisions; convert accepted quotations exactly once into governed sales orders.",
        "This scope covers quotation-to-order controls and invoice-request handoffs. Stock-backed reservations, pick-pack-ship, returns, sales contracts and recurring billing are not yet released.",
      ],
    },
    {
      eyebrow: "Early-access Accounting",
      title: "Operate core ledger, subledger, banking and close controls.",
      tone: "dark",
      paragraphs: [
        "Maintain chart of accounts, journals, receivables, payables, payments, allocations, banking records, assets, accruals, recurring entries, budgets, forecasts, foreign-exchange, intercompany and consolidation foundations.",
        "Run governed posting, reversal, close and reporting controls. India e-Invoice, E-Way Bill, GST-return filing and other live statutory provider workflows are not yet released.",
      ],
    },
    {
      eyebrow: "Early-access Procurement",
      title: "Validate selected source-to-pay controls from supplier through matching.",
      paragraphs: [
        "Manage supplier records, requisitions, sourcing events, bid evaluation, purchase orders, amendments, receipts and matching foundations.",
        "Supplier portals, complete onboarding, budget enforcement, mature service/return flows and stock-backed matching remain implementation work and are not represented as complete.",
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
    title: "Evaluate the controlled early-access workflows with real operating evidence.",
    description:
      "Bring real users, records, permission boundaries, exceptions and measurable acceptance criteria. The demo will stay inside explicitly supported early-access scope and disclose known limitations.",
    primary: { label: "Book a released-scope demo", href: "/book-demo" },
    secondary: { label: "Open the module roadmap", href: "/modules" },
  },
};

export default function ProductPage() {
  return <StructuredContentPage config={config} />;
}
