import { createPageMetadata } from "@/lib/metadata";

import StructuredContentPage, {
  type StructuredPageConfig,
} from "@/components/marketing/structured-content-page";

export const metadata = createPageMetadata({
  title: "Vercentlabs ERP Workflows | Released CRM and Roadmap",
  description:
    "Review the released CRM workflow and the clearly labelled future ERP workflow roadmap.",
  path: "/workflows",
});

const config: StructuredPageConfig = {
  hero: {
    eyebrow: "Workflow release map",
    title:
      "One customer workflow is released. The broader operating map is roadmap.",
    description:
      "Vercentlabs currently connects lead capture, qualification, conversion, opportunity progression, activities, supported approvals, reporting and mobile CRM. Cross-module finance, supply-chain, production, project, asset, retail, quality, support and people workflows are not yet released.",
    primary: { label: "Book a CRM workflow demo", href: "/book-demo" },
    secondary: { label: "Review released features", href: "/features" },
  },
  sections: [
    {
      eyebrow: "Released workflow",
      title: "Lead to governed opportunity.",
      connectedModules: "Released CRM plus shared platform foundation",
      paragraphs: [
        "Move a customer enquiry through qualification and conversion while preserving ownership, operating context, permissions and audit evidence.",
      ],
      steps: [
        "Capture through staff entry, signed public form or governed CSV import",
        "Assign source, campaign, tags, owner and deterministic score",
        "Review duplicates, consent and qualification evidence",
        "Convert exactly once into business partner, contact and opportunity",
        "Plan activities and progress the opportunity pipeline",
        "Request a supported stage-change or activity-completion command",
        "Approve or reject with version checks and separation of duties",
        "Review dashboards, reports, notifications, history and mobile state",
      ],
      outcome:
        "A complete released CRM journey that can be tested with real roles and records.",
    },
    {
      eyebrow: "Implemented supporting flows",
      title: "The platform controls around the CRM are also released.",
      tone: "dark",
      items: [
        {
          title: "Register to organisation",
          description:
            "Verified account creation continues into organisation, company, branch and administrator setup.",
        },
        {
          title: "Invite to permission",
          description:
            "Users, roles, memberships and operating access determine what each person can view or change.",
        },
        {
          title: "Import to governed record",
          description:
            "Permission-scoped imports validate rows, recover safely and retain audit evidence.",
        },
        {
          title: "Request to decision",
          description:
            "Supported CRM commands move through transactional approval and immutable decision history.",
        },
        {
          title: "Trial to entitlement",
          description:
            "Organisation-level billing state controls released module and write access without seat multiplication.",
        },
        {
          title: "Event to delivery",
          description:
            "Consent-aware outbox processing retries provider work and fails closed when credentials are unavailable.",
        },
      ],
    },
    {
      eyebrow: "Roadmap — not released",
      title: "Lead to cash beyond CRM.",
      connectedModules:
        "Sales, Stock, Projects, Accounting and other roadmap modules",
      paragraphs: [
        "Quotation, sales order, fulfilment, invoicing, payment and financial posting remain future scope.",
      ],
      outcome:
        "This workflow is product direction only and cannot be completed in the current release.",
    },
    {
      eyebrow: "Roadmap — not released",
      title: "Procure to pay.",
      connectedModules: "Procurement, Stock, Quality, Assets and Accounting",
      paragraphs: [
        "Purchase requests, supplier quotations, purchase orders, receipts, matching and payment remain future scope.",
      ],
      outcome:
        "This workflow is product direction only and cannot be completed in the current release.",
    },
    {
      eyebrow: "Roadmap — not released",
      title: "Plan to produce and inventory to fulfilment.",
      connectedModules:
        "Sales, Stock, Procurement, Manufacturing, Quality, Assets and Accounting",
      paragraphs: [
        "Demand planning, material requirements, production orders, quality inspections, warehouse execution and costing remain future scope.",
      ],
      outcome:
        "These workflows are product direction only and cannot be completed in the current release.",
    },
    {
      eyebrow: "Roadmap — not released",
      title: "Project, people, service, asset and retail lifecycles.",
      connectedModules:
        "Projects, HR & Payroll, Support, Assets, Point of Sale and Accounting",
      paragraphs: [
        "Project-to-profit, hire-to-pay, issue-to-resolution, asset lifecycle and point-of-sale accounting remain future scope.",
      ],
      outcome:
        "These workflows are product direction only and cannot be completed in the current release.",
    },
    {
      eyebrow: "Release rule",
      title: "A workflow is not released when only its screens exist.",
      bullets: [
        "Records and migrations are complete",
        "Permissions and tenant boundaries are enforced",
        "Commands and approvals are transactional",
        "Reports and audit history are accurate",
        "Web and required mobile journeys are usable",
        "Failure, retry and provider states are safe",
        "Automated and manual acceptance evidence exists",
      ],
    },
  ],
  finalCta: {
    title: "Challenge the released CRM workflow with your real operating case.",
    description:
      "Bring the roles, records, handoffs, exceptions and evidence required. Roadmap workflows will remain labelled as roadmap during the session.",
    primary: { label: "Book a CRM workflow demo", href: "/book-demo" },
    secondary: { label: "See implementation method", href: "/how-it-works" },
  },
};

export default function WorkflowsPage() {
  return <StructuredContentPage config={config} />;
}
