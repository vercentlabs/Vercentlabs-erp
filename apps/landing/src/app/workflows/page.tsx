import { createPageMetadata } from "@/lib/metadata";

import StructuredContentPage, {
  type ContentSection,
  type StructuredPageConfig,
} from "@/components/marketing/structured-content-page";

export const metadata = createPageMetadata({
  title: "ERP Workflows | Connect Every Business Process with VercentLabs ERP",
  description:
    "Connect sales, procurement, inventory, manufacturing, projects, finance, quality, employees and support through complete VercentLabs ERP workflows.",
  path: "/workflows",
});

const workflows: ContentSection[] = [
  {
    title: "Lead to cash",
    connectedModules:
      "CRM, Sales, Stock, Manufacturing, Projects and Accounting",
    paragraphs: ["Transform customer interest into collected revenue."],
    steps: [
      "Capture the lead",
      "Qualify the opportunity",
      "Schedule activities and follow-ups",
      "Prepare the quotation",
      "Apply pricing and approval rules",
      "Confirm the sales order",
      "Reserve, purchase or manufacture required items",
      "Deliver products or services",
      "Generate the customer invoice",
      "Record and reconcile payment",
    ],
    outcome:
      "Sales, fulfilment and finance operate from one connected customer transaction.",
  },
  {
    title: "Procure to pay",
    connectedModules:
      "Procurement, Stock, Quality, Projects, Assets and Accounting",
    paragraphs: [
      "Control purchasing from the first requirement through supplier payment.",
    ],
    steps: [
      "Raise a purchase request",
      "Review the business requirement",
      "Request supplier quotations",
      "Compare suppliers and commercial terms",
      "Approve the purchase",
      "Create the purchase order",
      "Receive goods or services",
      "Complete quantity and quality checks",
      "Match the supplier invoice",
      "Approve and process payment",
    ],
    outcome:
      "Reduce uncontrolled purchasing, invoice mismatches and weak supplier visibility.",
  },
  {
    title: "Plan to produce",
    connectedModules:
      "Sales, Stock, Procurement, Manufacturing, Quality, Assets and Accounting",
    paragraphs: ["Convert demand into planned and cost-controlled production."],
    steps: [
      "Review customer and forecast demand",
      "Confirm bills of materials",
      "Calculate material requirements",
      "Review available inventory",
      "Procure missing materials",
      "Create production orders",
      "Assign work centres and resources",
      "Issue materials to production",
      "Record production output",
      "Complete quality inspections",
      "Receive finished goods",
      "Calculate actual manufacturing cost",
    ],
    outcome:
      "Production teams gain visibility into demand, shortages, capacity, quality and cost.",
  },
  {
    title: "Inventory to fulfilment",
    connectedModules:
      "Stock, Procurement, Sales, Manufacturing, Quality, Point of Sale and Accounting",
    paragraphs: [
      "Maintain accurate inventory while fulfilling customer demand.",
    ],
    steps: [
      "Receive purchased or manufactured stock",
      "Verify quantity and quality",
      "Record batch or serial information",
      "Place items into the correct location",
      "Monitor stock availability",
      "Create replenishment requirements",
      "Reserve stock for demand",
      "Pick and pack the order",
      "Dispatch or transfer inventory",
      "Confirm delivery",
      "Process returns or adjustments",
    ],
    outcome:
      "Improve stock accuracy, availability, traceability and fulfilment performance.",
  },
  {
    title: "Project to profit",
    connectedModules:
      "CRM, Sales, Projects, Procurement, HR & Payroll and Accounting",
    paragraphs: [
      "Connect commercial commitments with project delivery and profitability.",
    ],
    steps: [
      "Qualify the project opportunity",
      "Estimate scope, effort and cost",
      "Prepare the commercial proposal",
      "Confirm the customer agreement",
      "Create the project and budget",
      "Plan tasks and milestones",
      "Assign employees and resources",
      "Record time, expenses and purchases",
      "Monitor delivery progress",
      "Generate customer billing",
      "Review cost, revenue and margin",
    ],
    outcome:
      "Understand project progress, resource usage, billing and profitability from one system.",
  },
  {
    title: "Hire to payroll",
    connectedModules: "HR & Payroll, Projects and Accounting",
    paragraphs: [
      "Manage employee information, attendance and compensation through a connected process.",
    ],
    steps: [
      "Create the employee record",
      "Assign company, department and role",
      "Complete onboarding activities",
      "Configure attendance and leave rules",
      "Record attendance, shifts and leave",
      "Record allowances and deductions",
      "Validate payroll inputs",
      "Calculate payroll",
      "Review and approve payroll",
      "Generate salary records",
      "Post payroll costs to accounts and cost centres",
    ],
    outcome:
      "Reduce manual payroll work and connect employee costs with departments and projects.",
  },
  {
    title: "Issue to resolution",
    connectedModules:
      "Support, CRM, Sales, Stock, Quality, Projects and Accounting",
    paragraphs: [
      "Resolve customer issues with full commercial and operational context.",
    ],
    steps: [
      "Capture the support request",
      "Identify the customer and related transaction",
      "Set category, priority and response target",
      "Assign the responsible team",
      "Investigate the issue",
      "Communicate progress",
      "Coordinate service, return or replacement",
      "Record quality findings",
      "Complete the resolution",
      "Confirm customer acceptance",
      "Analyse the root cause",
    ],
    outcome:
      "Give support teams complete customer context and help the organisation prevent repeated issues.",
  },
  {
    title: "Asset acquisition to disposal",
    connectedModules: "Procurement, Assets, Projects, Accounting and Support",
    paragraphs: [
      "Track an asset throughout its complete operational and financial lifecycle.",
    ],
    steps: [
      "Raise the asset requirement",
      "Approve the purchase",
      "Create the purchase order",
      "Receive and verify the asset",
      "Create the asset record",
      "Assign location and ownership",
      "Calculate depreciation",
      "Schedule maintenance",
      "Record transfers and service history",
      "Retire, sell or dispose of the asset",
    ],
    outcome:
      "Maintain accurate asset ownership, value, condition and lifecycle history.",
  },
  {
    title: "Point of sale to accounting",
    connectedModules: "Point of Sale, Stock, Sales, CRM and Accounting",
    paragraphs: [
      "Connect retail transactions with customers, inventory and finance.",
    ],
    steps: [
      "Open the sales shift",
      "Select products or services",
      "Identify the customer when required",
      "Apply pricing and discounts",
      "Accept payment",
      "Generate the receipt",
      "Update inventory",
      "Record taxes and accounting impact",
      "Process returns or refunds",
      "Close and reconcile the shift",
    ],
    outcome:
      "Give retail teams a fast sales experience while maintaining inventory and financial accuracy.",
  },
];

const config: StructuredPageConfig = {
  hero: {
    eyebrow: "Connected ERP Workflows",
    title:
      "Run complete business processes instead of disconnected departmental tasks.",
    description:
      "VercentLabs ERP connects people, data, approvals and accounting across every stage of an operation. Each department completes its responsibility while the wider business maintains one complete and traceable transaction history.",
    primary: { label: "Book a workflow demo", href: "/contact" },
    secondary: { label: "Explore the product", href: "/product" },
  },
  sections: [
    ...workflows,
    {
      eyebrow: "Shared governance",
      title: "Controls across every workflow",
      tone: "dark",
      items: [
        {
          title: "Ownership",
          description:
            "Assign every activity to a responsible user, team, department or role.",
        },
        {
          title: "Approvals",
          description: "Apply controlled approval limits and escalation paths.",
        },
        {
          title: "Validation",
          description:
            "Prevent incomplete, invalid or unauthorised transactions.",
        },
        {
          title: "Exception management",
          description:
            "Keep shortages, delays, failed inspections and overdue actions visible until resolved.",
        },
        {
          title: "Notifications",
          description:
            "Alert users about tasks, approvals, deadlines and exceptions.",
        },
        {
          title: "Audit history",
          description:
            "Retain the complete user, date, approval and transaction history.",
        },
        {
          title: "Connected accounting",
          description:
            "Generate the appropriate financial impact from approved operational transactions.",
        },
        {
          title: "Reporting",
          description:
            "Analyse complete processes instead of isolated departmental activity.",
        },
      ],
    },
  ],
  finalCta: {
    title: "See your real business workflow inside VercentLabs ERP.",
    description:
      "Bring your current process, responsibilities, approvals and reporting requirements to a personalised workflow demonstration.",
    primary: { label: "Book a workflow demo", href: "/contact" },
    secondary: {
      label: "See how VercentLabs ERP works",
      href: "/how-it-works",
    },
  },
};

export default function WorkflowsPage() {
  return <StructuredContentPage config={config} />;
}
