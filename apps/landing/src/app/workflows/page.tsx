import { createPageMetadata } from "@/lib/metadata";

import StructuredContentPage, {
  type StructuredPageConfig,
} from "@/components/marketing/structured-content-page";

export const metadata = createPageMetadata({
  title: "Vercentlabs ERP Workflows | Released Business Flows and Roadmap",
  description:
    "Review released CRM, quotation-to-order, source-to-pay and accounting workflows alongside the clearly labelled ERP roadmap.",
  path: "/workflows",
});

const config: StructuredPageConfig = {
  hero: {
    eyebrow: "Workflow release map",
    title: "Four business modules are released as connected, governed workflows.",
    description:
      "Vercentlabs currently connects CRM, Sales, Procurement and Accounting on one permission, approval, audit and master-data foundation. Stock-dependent execution remains an explicit boundary until the Stock module is released.",
    primary: { label: "Book an ERP workflow demo", href: "/book-demo" },
    secondary: { label: "Review released features", href: "/features" },
  },
  sections: [
    {
      eyebrow: "Released workflow",
      title: "Lead to governed opportunity.",
      connectedModules: "CRM plus shared platform foundation",
      steps: [
        "Capture through staff entry, signed public form or governed CSV import",
        "Assign source, campaign, tags, owner and deterministic score",
        "Review duplicates, consent and qualification evidence",
        "Convert exactly once into partner, contact and opportunity",
        "Plan activities and progress the opportunity pipeline",
        "Use supported approvals, reports, history and mobile CRM",
      ],
      outcome: "A complete CRM journey with real roles, records and denials.",
    },
    {
      eyebrow: "Released workflow",
      title: "Opportunity to accepted quotation and governed sales order.",
      connectedModules: "CRM, Sales and Accounting handoff contracts",
      steps: [
        "Create a versioned quotation from an opportunity or customer",
        "Resolve deterministic price, discount, tax and margin evidence",
        "Approve when commercial policy requires it",
        "Send a secure customer decision link",
        "Accept or reject without exposing internal controls",
        "Convert the accepted quotation exactly once into a sales order",
        "Confirm, hold, amend or cancel with immutable version history",
        "Issue idempotent fulfilment and invoice requests",
      ],
      outcome:
        "A controlled quotation-to-order flow with durable downstream handoffs; warehouse execution remains Stock roadmap scope.",
    },
    {
      eyebrow: "Released workflow",
      title: "Requirement to supplier commitment and invoice match.",
      connectedModules: "Procurement and Accounting handoff contracts",
      steps: [
        "Qualify suppliers and preserve compliance evidence",
        "Create, submit and approve purchase requisitions",
        "Invite bids, evaluate responses and award sourcing events",
        "Create and approve agreements or purchase orders",
        "Dispatch and amend orders with version controls",
        "Record goods, service or return evidence",
        "Run two-, three- or four-way invoice matching",
        "Route tolerance failures into explicit exceptions and audit history",
      ],
      outcome:
        "A governed source-to-pay control flow through matching; physical stock movement remains Stock roadmap scope.",
    },
    {
      eyebrow: "Released workflow",
      title: "Subledger document to ledger, settlement and close.",
      connectedModules: "Accounting with Sales and Procurement source references",
      steps: [
        "Create receivable or payable documents with source evidence",
        "Validate accounting periods, dimensions, currency and tax",
        "Post balanced immutable journal entries",
        "Allocate receipts or payments and manage aging",
        "Reconcile bank statements and investigate exceptions",
        "Run accruals, recurring entries, depreciation and FX revaluation",
        "Complete governed period-close tasks",
        "Produce trial balance, P&L, balance sheet and cash-flow reports",
      ],
      outcome: "A traceable record-to-report workflow with controlled reversals and close evidence.",
    },
    {
      eyebrow: "Implemented supporting flows",
      title: "The platform controls around every released module are also implemented.",
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
            "Supported commands move through transactional approval and immutable decision history.",
        },
        {
          title: "Trial to entitlement",
          description:
            "Organisation-level billing state controls released modules and write access without seat multiplication.",
        },
        {
          title: "Event to delivery",
          description:
            "Retryable outboxes preserve idempotency and fail closed when provider credentials are unavailable.",
        },
      ],
    },
    {
      eyebrow: "Roadmap — not released",
      title: "Operational flows that still require future modules.",
      connectedModules:
        "Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support and HR & Payroll",
      paragraphs: [
        "Inventory reservation, warehouse picking, dispatch, valuation, manufacturing execution, project delivery, asset operations, retail checkout, quality execution, support case management and people/payroll workflows remain future scope.",
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
    title: "Challenge the released workflows with your real operating case.",
    description:
      "Bring the roles, records, handoffs, exceptions and evidence required. Roadmap workflows will remain labelled as roadmap during the session.",
    primary: { label: "Book an ERP workflow demo", href: "/book-demo" },
    secondary: { label: "See implementation method", href: "/how-it-works" },
  },
};

export default function WorkflowsPage() {
  return <StructuredContentPage config={config} />;
}
