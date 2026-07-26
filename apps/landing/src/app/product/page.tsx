import { createPageMetadata } from "@/lib/metadata";

import StructuredContentPage, {
  type StructuredPageConfig,
} from "@/components/marketing/structured-content-page";

export const metadata = createPageMetadata({
  title: "Vercentlabs ERP Product | Released CRM and Platform Foundation",
  description:
    "Review the released Vercentlabs platform foundation and CRM early-access scope, with eleven future ERP modules clearly separated as roadmap.",
  path: "/product",
});

const config: StructuredPageConfig = {
  hero: {
    eyebrow: "Current product boundary",
    title: "A governed operating foundation with CRM released end to end.",
    description:
      "Vercentlabs ERP currently delivers identity, organisation context, permissions, governed business data, approvals, audit history, billing controls and CRM across web and mobile. Eleven operational modules remain explicit roadmap scope.",
    primary: { label: "Book a released-scope demo", href: "/book-demo" },
    secondary: { label: "Inspect all released features", href: "/features" },
  },
  sections: [
    {
      eyebrow: "Released CRM",
      title: "Run the customer lifecycle from capture to governed decision.",
      paragraphs: [
        "The released module supports staff entry, signed public capture, import, assignment, scoring, qualification, conversion, opportunity progression, activities, campaigns, reports and privacy records.",
        "Supported opportunity stage changes and activity completion can be requested through transactional approvals with permission checks, separation of duties and immutable decision history.",
      ],
      bullets: [
        "Lead capture, duplicate controls and deterministic scoring",
        "Lead conversion into partner, contact and opportunity records",
        "Opportunity pipeline, forecasting and stage history",
        "Tasks, calls, meetings and follow-up ownership",
        "Campaigns, sequences and consent-aware outbound processing",
        "CRM dashboards, reports, mobile workflows and offline-safe mutations",
      ],
      outcome:
        "A complete early-access CRM workflow that can be tested with real roles, records, denials and acceptance criteria.",
    },
    {
      eyebrow: "Implemented foundation",
      title:
        "Keep identity, context and evidence consistent underneath the module.",
      tone: "dark",
      items: [
        {
          title: "Account lifecycle",
          description:
            "Registration, verified email, sessions, password recovery and protected authentication flows live in the secure ERP application.",
        },
        {
          title: "Organisation context",
          description:
            "Companies, branches, departments, teams, cost centres and active operating context constrain application behaviour.",
        },
        {
          title: "Permission enforcement",
          description:
            "Navigation, APIs, commands and PostgreSQL row-level security enforce role, organisation, company and branch boundaries.",
        },
        {
          title: "Governed master data",
          description:
            "Business partners, contacts, items, warehouses, currencies, terms and tax setup provide shared records for current and future modules.",
        },
        {
          title: "Audit and approvals",
          description:
            "Security events, business changes and supported CRM decisions retain traceable user, version and command evidence.",
        },
        {
          title: "Commercial controls",
          description:
            "Organisation-level trials, entitlements, usage and Razorpay integration remain gated by production configuration.",
        },
      ],
    },
    {
      eyebrow: "Roadmap — not released",
      title:
        "Eleven modules are visible product direction, not current functionality.",
      paragraphs: [
        "Accounting, Procurement, Sales, Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support and HR & Payroll cannot be activated in the current release.",
        "Each module will become available only after its records, permissions, workflows, approvals, reporting, migrations, web experience, mobile scope and acceptance evidence are complete.",
      ],
      cta: { label: "Review the transparent module map", href: "/modules" },
    },
    {
      eyebrow: "Evaluation method",
      title: "Test a real operating scenario—not a feature slideshow.",
      bullets: [
        "Use at least two organisations to prove tenant isolation",
        "Use administrator and restricted roles to prove permission denials",
        "Import realistic records and inspect row-level recovery",
        "Run lead qualification, conversion and opportunity progression",
        "Request and decide a supported approval command",
        "Inspect reports, audit history and mobile permission behaviour",
      ],
      cta: { label: "Review implementation approach", href: "/how-it-works" },
    },
  ],
  finalCta: {
    title: "Evaluate what exists today before discussing what comes next.",
    description:
      "Bring one customer workflow, the real users, operating boundaries and measurable acceptance criteria. The demo will stay inside released scope.",
    primary: { label: "Book a released-scope demo", href: "/book-demo" },
    secondary: { label: "Open the module roadmap", href: "/modules" },
  },
};

export default function ProductPage() {
  return <StructuredContentPage config={config} />;
}
