import { createPageMetadata } from "@/lib/metadata";

import StructuredContentPage, {
  type StructuredPageConfig,
} from "@/components/marketing/structured-content-page";

export const metadata = createPageMetadata({
  title:
    "How VercentLabs ERP Works | From Business Discovery to Daily Operations",
  description:
    "See how VercentLabs ERP is configured, implemented and used to connect your business processes, teams, data and reporting.",
  path: "/how-it-works",
});

const config: StructuredPageConfig = {
  hero: {
    eyebrow: "How VercentLabs ERP Works",
    title: "Configure VercentLabs ERP around the way your business operates.",
    description:
      "VercentLabs ERP combines modular applications, shared business data, configurable workflows and role-based access. The platform is implemented around your organisation, processes and responsibilities rather than forcing every business into the same operating model.",
    primary: { label: "Book a product walkthrough", href: "/contact" },
    secondary: { label: "Explore workflows", href: "/workflows" },
  },
  sections: [
    {
      eyebrow: "Step 1",
      title: "Understand your business",
      paragraphs: [
        "Implementation begins by understanding how your organisation currently operates.",
        "We document:",
      ],
      bullets: [
        "Companies, branches and locations",
        "Departments and responsibilities",
        "Customers, suppliers and products",
        "Existing applications and spreadsheets",
        "Current workflows and approval requirements",
        "Operational problems and process gaps",
        "Reporting and compliance requirements",
        "Data migration and integration requirements",
      ],
      outcome:
        "A clear implementation scope based on real business priorities.",
    },
    {
      eyebrow: "Step 2",
      title: "Select the required modules",
      paragraphs: [
        "Start with the released CRM scope and identify roadmap modules required for later implementation phases.",
        "The transparent product roadmap includes:",
      ],
      bullets: [
        "Accounting",
        "Procurement",
        "Sales",
        "CRM",
        "Stock",
        "Manufacturing",
        "Projects",
        "Assets",
        "Point of Sale",
        "Quality",
        "Support",
        "HR & Payroll",
      ],
      afterBullets:
        "CRM is the current released early-access module. Every other module is planned scope until it passes its release gate.",
      outcome:
        "A practical module plan aligned with your most important workflows.",
    },
    {
      eyebrow: "Step 3",
      title: "Configure your organisation",
      paragraphs: [
        "VercentLabs ERP is configured around your business structure.",
        "Configuration may include:",
      ],
      bullets: [
        "Companies and legal entities",
        "Branches and operating locations",
        "Warehouses and stock locations",
        "Departments and cost centres",
        "Financial structure",
        "Tax and accounting rules",
        "Roles and user permissions",
        "Approval authorities",
        "Numbering and document formats",
        "Business calendars and working rules",
      ],
      outcome:
        "A system structure that represents the way your organisation works.",
    },
    {
      eyebrow: "Step 4",
      title: "Configure workflows and controls",
      paragraphs: [
        "Business workflows are configured around responsibilities and decision rules.",
        "This can include:",
      ],
      bullets: [
        "Automatic task assignments",
        "Approval limits",
        "Multi-level approvals",
        "Notifications and reminders",
        "Escalation rules",
        "Exception handling",
        "Status transitions",
        "Document requirements",
        "Validation rules",
        "Audit tracking",
      ],
      outcome: "Processes that are controlled, understandable and traceable.",
    },
    {
      eyebrow: "Step 5",
      title: "Prepare and migrate business data",
      paragraphs: [
        "Existing business information is reviewed, cleaned and prepared for migration.",
        "Data may include:",
      ],
      bullets: [
        "Customers and suppliers",
        "Products and services",
        "Opening inventory",
        "Chart of accounts",
        "Outstanding receivables and payables",
        "Employees",
        "Assets",
        "Projects",
        "Historical reference information",
      ],
      steps: [
        "Identify source data",
        "Map data fields",
        "Clean duplicate or incomplete records",
        "Perform trial migration",
        "Validate migrated data",
        "Approve the final migration",
        "Complete production cutover",
      ],
      stepsLabel: "Migration follows a controlled process:",
      outcome: "Reliable starting data inside VercentLabs ERP.",
    },
    {
      eyebrow: "Step 6",
      title: "Validate complete business scenarios",
      paragraphs: [
        "The system is tested using real operating scenarios.",
        "Testing covers:",
      ],
      bullets: [
        "User permissions",
        "Approval workflows",
        "Calculations",
        "Documents",
        "Reports",
        "Module integrations",
        "Exception handling",
        "Accounting impact",
        "Data migration",
        "External integrations",
      ],
      outcome:
        "Confirmed workflows before the system is used for live operations.",
    },
    {
      eyebrow: "Step 7",
      title: "Train users by responsibility",
      paragraphs: [
        "Users are trained according to their actual roles.",
        "Training focuses on:",
      ],
      bullets: [
        "Daily responsibilities",
        "Required transactions",
        "Approvals",
        "Exception management",
        "Dashboards",
        "Reports",
        "Data ownership",
        "Support processes",
      ],
      outcome:
        "Users understand what they need to do, why they need to do it and how their work affects other departments.",
    },
    {
      eyebrow: "Step 8",
      title: "Launch through a controlled go-live",
      paragraphs: [
        "The production system is launched through a planned cutover.",
        "The go-live process can include:",
      ],
      bullets: [
        "Final data migration",
        "User access activation",
        "Opening balance validation",
        "Inventory validation",
        "Workflow activation",
        "Integration activation",
        "Transaction monitoring",
        "User assistance",
        "Issue prioritisation",
      ],
      outcome: "A controlled transition from old systems to VercentLabs ERP.",
    },
    {
      eyebrow: "Step 9",
      title: "Run daily operations",
      paragraphs: [
        "Once live, VercentLabs ERP becomes the shared operating platform for your teams.",
        "A typical transaction follows this pattern:",
      ],
      tone: "dark",
      items: [
        {
          title: "A business event is created",
          description:
            "A lead, purchase request, sales order, support issue, production order or employee activity enters the system.",
        },
        {
          title: "The responsible user receives the work",
          description:
            "The transaction is assigned according to role, department, location or workflow.",
        },
        {
          title: "Business rules are applied",
          description:
            "The system validates data, pricing, availability, permissions and approval requirements.",
        },
        {
          title: "Approvals are completed",
          description:
            "Required managers or authorised users review and approve the activity.",
        },
        {
          title: "Connected modules are updated",
          description:
            "The transaction updates inventory, production, projects, accounting or other related areas.",
        },
        {
          title: "Management receives visibility",
          description:
            "Dashboards and reports reflect the latest operational and financial position.",
        },
        {
          title: "The complete history remains available",
          description:
            "Users can review activities, approvals, documents, changes and transaction relationships.",
        },
      ],
    },
    {
      eyebrow: "Step 10",
      title: "Improve and expand",
      paragraphs: [
        "After go-live, the system can expand as the organisation grows.",
        "You can:",
      ],
      bullets: [
        "Add more modules",
        "Add companies and branches",
        "Add users and roles",
        "Improve approval rules",
        "Automate more activities",
        "Add integrations",
        "Create new reports",
        "Introduce additional workflows",
        "Standardise more business processes",
      ],
      outcome: "An ERP platform that grows with your organisation.",
    },
  ],
  finalCta: {
    title: "See how VercentLabs ERP would work inside your organisation.",
    description:
      "Walk through your current processes, responsibilities, approvals and reporting requirements with our team.",
    primary: { label: "Book a product walkthrough", href: "/contact" },
    secondary: { label: "Explore the product", href: "/product" },
  },
};

export default function HowItWorksPage() {
  return <StructuredContentPage config={config} />;
}
