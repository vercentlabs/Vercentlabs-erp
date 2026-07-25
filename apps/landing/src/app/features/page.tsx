import { createPageMetadata } from "@/lib/metadata";

import StructuredContentPage, {
  type ContentItem,
  type StructuredPageConfig,
} from "@/components/marketing/structured-content-page";

export const metadata = createPageMetadata({
  title: "VercentLabs ERP Features | Platform Foundation and CRM",
  description:
    "Explore the released VercentLabs ERP platform foundation and CRM capabilities, with eleven additional ERP modules clearly separated as roadmap scope.",
  path: "/features",
});

const items = (entries: Array<[string, string]>): ContentItem[] =>
  entries.map(([title, description]) => ({ title, description }));

const config: StructuredPageConfig = {
  hero: {
    eyebrow: "Released early-access scope",
    title: "A governed platform foundation with complete CRM workflows.",
    description:
      "The current release covers authentication, organisation administration, permissions, shared master data, auditability, billing controls, governed approvals and CRM. The remaining eleven ERP modules are roadmap items and cannot be activated in this release.",
    primary: { label: "Book a CRM walkthrough", href: "/contact" },
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
          "Prepare warehouses, currencies, payment terms and tax configuration without presenting unreleased inventory or accounting transactions.",
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
      title: "Eleven modules remain future scope.",
      paragraphs: [
        "Accounting, Procurement, Sales, Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support and HR & Payroll are registered as roadmap modules only.",
        "They cannot be enabled through the current UI or API. Each will be released later only after its records, workflows, approvals, reporting, permissions, tests and migration path are complete end to end.",
      ],
    },
  ],
  finalCta: {
    title:
      "Evaluate the released CRM and platform foundation against a real workflow.",
    description:
      "Use a complete lead-to-opportunity scenario, real roles, permission denials, imports, reports and approval decisions rather than evaluating isolated screens.",
    primary: { label: "Book a CRM walkthrough", href: "/contact" },
    secondary: { label: "Explore the module roadmap", href: "/modules" },
  },
};

export default function FeaturesPage() {
  return <StructuredContentPage config={config} />;
}
