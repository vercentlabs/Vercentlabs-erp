import { createPageMetadata } from "@/lib/metadata";

import StructuredContentPage, {
  type StructuredPageConfig,
} from "@/components/marketing/structured-content-page";

export const metadata = createPageMetadata({
  title: "How Vercentlabs ERP Early Access Works",
  description:
    "See how Vercentlabs scopes, configures, validates and launches released CRM, Sales, Accounting and Procurement workflows.",
  path: "/how-it-works",
});

const config: StructuredPageConfig = {
  hero: {
    eyebrow: "Implementation method",
    title: "Move from operating evidence to a controlled ERP release.",
    description:
      "The implementation path is evidence-led: select a released workflow, configure organisation and permissions, migrate the required records, validate CRM, Sales, Accounting or Procurement end to end and expand only after acceptance.",
    primary: { label: "Book a scope workshop", href: "/book-demo" },
    secondary: { label: "Review released product", href: "/product" },
  },
  sections: [
    {
      eyebrow: "Step 1",
      title: "Define the operating problem and acceptance boundary.",
      paragraphs: [
        "Document the users, companies, branches, records, handoffs, decisions, exceptions and evidence required for one customer workflow.",
      ],
      bullets: [
        "Current systems and spreadsheets",
        "Named process owner and participating roles",
        "Organisation, company and branch boundaries",
        "Required records, reports and audit evidence",
        "Success criteria and explicit out-of-scope work",
      ],
      outcome:
        "A pilot brief that can be accepted or rejected using observable evidence.",
    },
    {
      eyebrow: "Step 2",
      title: "Configure the organisation and secure account lifecycle.",
      paragraphs: [
        "Create the organisation, primary company, branch, user accounts, verified email path and active operating context in the secure ERP application.",
      ],
      bullets: [
        "Organisation, company and branch setup",
        "Departments, teams and cost centres",
        "Administrator and restricted-role users",
        "Session, password and email-verification controls",
        "Default numbering, CRM configuration and billing trial",
      ],
      outcome:
        "A tenant-scoped workspace ready for realistic permission testing.",
    },
    {
      eyebrow: "Step 3",
      title: "Prepare the business records the released workflow depends on.",
      paragraphs: [
        "Clean and import only the master data and transaction-opening records required by the pilot. Invalid rows are isolated so valid rows can continue safely.",
      ],
      bullets: [
        "Business partners and contacts",
        "Users, owners and assignees",
        "CRM stages, price and tax setup, supplier controls and accounting dimensions",
        "Companies, branches and permitted operating scope",
        "CSV trial import, validation and permission-scoped export",
      ],
      outcome:
        "Traceable starting data without pretending that roadmap transactions exist.",
    },
    {
      eyebrow: "Step 4",
      title: "Configure roles, permissions and supported decisions.",
      paragraphs: [
        "Grant only the actions each role needs and verify denied paths as deliberately as successful ones.",
      ],
      bullets: [
        "Module view, resource-specific manage and report permissions",
        "Company and branch access",
        "Approval-manager access",
        "Billing visibility and checkout permissions",
        "Supported CRM, Sales, Accounting and Procurement approvals",
        "Separation-of-duties and version-controlled decisions",
      ],
      afterBullets:
        "The current release does not claim a generic multi-level approval designer or delegated approval chains.",
      outcome:
        "An explicit operating boundary enforced in navigation, APIs, commands and row-level security.",
    },
    {
      eyebrow: "Step 5",
      title: "Run the selected released workflow end to end.",
      steps: [
        "Create or import the workflow opening record",
        "Apply ownership, operating scope, commercial or financial policy",
        "Validate duplicates, references, approval rules and supporting evidence",
        "Progress records through idempotent, version-controlled commands",
        "Complete the CRM, quotation, sourcing, order, matching or posting sequence",
        "Request a governed command when approval is required",
        "Decide the request with version and separation-of-duties checks",
        "Inspect reports, notifications, audit history and mobile behaviour",
      ],
      stepsLabel: "Acceptance sequence",
      outcome:
        "A complete workflow with both successful and denied paths demonstrated.",
    },
    {
      eyebrow: "Step 6",
      title: "Validate with real roles, devices and failure states.",
      tone: "dark",
      items: [
        {
          title: "Tenant isolation",
          description:
            "Use at least two organisations and prove that records, search, reports and commands never cross the boundary.",
        },
        {
          title: "Permission denial",
          description:
            "Use a restricted user to verify hidden controls and rejected direct API mutations.",
        },
        {
          title: "Web and mobile parity",
          description:
            "Confirm released web workflows and supported CRM mobile views and mutations on Android and iOS export paths.",
        },
        {
          title: "Operational failure",
          description:
            "Exercise invalid input, unavailable providers, retries, rate limits and safe error messages.",
        },
        {
          title: "Release gate",
          description:
            "Run tests, lint, TypeScript, production builds, database checks and deployment smoke before promotion.",
        },
        {
          title: "Evidence",
          description:
            "Record acceptance results, known limitations, production configuration and rollback steps.",
        },
      ],
    },
    {
      eyebrow: "Step 7",
      title: "Launch the accepted scope and observe adoption.",
      paragraphs: [
        "Promote only the workflow that passed acceptance. Monitor data quality, permission usage, failed jobs, provider delivery and the questions users still need answered.",
      ],
      outcome:
        "A controlled early-access release with a known support and rollback path.",
    },
    {
      eyebrow: "Roadmap boundary",
      title: "Treat every future module as a separate release programme.",
      paragraphs: [
        "Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support and HR & Payroll remain roadmap scope.",
        "They are not added to an implementation plan as available modules until each one passes its own end-to-end release gate.",
      ],
      cta: { label: "Review the module roadmap", href: "/modules" },
    },
  ],
  finalCta: {
    title: "Bring one real workflow and test the product against it.",
    description:
      "The strongest next step is a narrow scenario with named users, realistic records, explicit denials and measurable acceptance criteria.",
    primary: { label: "Book a scope workshop", href: "/book-demo" },
    secondary: { label: "Review released workflows", href: "/workflows" },
  },
};

export default function HowItWorksPage() {
  return <StructuredContentPage config={config} />;
}
