import { createPageMetadata } from "@/lib/metadata";

import StructuredContentPage, {
  type StructuredPageConfig,
} from "@/components/marketing/structured-content-page";

export const metadata = createPageMetadata({
  title: "VercentLabs ERP Product | Platform Foundation and CRM Preview",
  description:
    "Review the implemented platform foundation and CRM preview, plus the planned roadmap for additional ERP operations.",
  path: "/product",
});

const config: StructuredPageConfig = {
  hero: {
    eyebrow: "VercentLabs ERP",
    title: "Build connected operations on a governed ERP foundation.",
    description:
      "VercentLabs ERP currently provides a governed platform foundation and CRM preview. The wider finance, procurement, inventory, production, project and people roadmap is being developed through phased design-partner validation.",
    primary: { label: "Book a personalised demo", href: "/contact" },
    secondary: { label: "Explore the module roadmap", href: "/modules" },
  },
  sections: [
    {
      eyebrow: "Connected operations",
      title: "One platform. One source of business truth.",
      paragraphs: [
        "When departments operate through separate applications and spreadsheets, information becomes duplicated, decisions slow down and management loses visibility.",
        "VercentLabs ERP brings your people, processes and business data together. Every department works from shared records while maintaining the permissions, responsibilities and workflows required for its role.",
      ],
      items: [
        {
          title: "Connected business data",
          description:
            "Maintain consistent records for customers, suppliers, products, employees, locations, accounts, assets and transactions.",
        },
        {
          title: "End-to-end operations",
          description:
            "Connect every stage of a business process instead of managing isolated departmental activities.",
        },
        {
          title: "Role-based experience",
          description:
            "Give every user a focused workspace based on their responsibilities, department, company and location.",
        },
        {
          title: "Real-time visibility",
          description:
            "Monitor transactions, approvals, workloads, exceptions and performance from live dashboards and reports.",
        },
      ],
    },
    {
      eyebrow: "Complete business management",
      title: "Planned module roadmap for phased business management",
      items: [
        {
          title: "Accounting",
          description:
            "Manage receivables, payables, journals, taxes, budgets, bank reconciliation, financial periods and business reporting.",
        },
        {
          title: "Procurement",
          description:
            "Control purchase requests, quotations, supplier selection, approvals, purchase orders, receipts and supplier invoices.",
        },
        {
          title: "Sales",
          description:
            "Create quotations, manage pricing, confirm sales orders, coordinate fulfilment, process returns and monitor sales performance.",
        },
        {
          title: "CRM",
          description:
            "Capture leads, manage opportunities, schedule follow-ups, record customer interactions and improve pipeline visibility.",
        },
        {
          title: "Stock",
          description:
            "Track inventory across warehouses and locations with receipts, deliveries, transfers, batches, serial numbers and replenishment.",
        },
        {
          title: "Manufacturing",
          description:
            "Manage bills of materials, production orders, work centres, operations, material consumption, finished goods and manufacturing costs.",
        },
        {
          title: "Projects",
          description:
            "Plan projects, organise tasks, assign resources, record time and expenses, manage budgets and track profitability.",
        },
        {
          title: "Assets",
          description:
            "Maintain asset records, locations, ownership, depreciation, maintenance, transfers and disposal history.",
        },
        {
          title: "Point of Sale",
          description:
            "Process retail transactions, payments, discounts, returns, shifts and inventory updates through a fast sales interface.",
        },
        {
          title: "Quality",
          description:
            "Define quality checkpoints, perform inspections, record results, manage non-conformances and track corrective actions.",
        },
        {
          title: "Support",
          description:
            "Manage customer requests, priorities, assignments, communication, service targets and complete resolution history.",
        },
        {
          title: "HR & Payroll",
          description:
            "Manage employee information, attendance, leave, payroll, reimbursements and employee lifecycle activities.",
        },
      ],
      cta: { label: "View all modules", href: "/modules" },
    },
    {
      eyebrow: "Consistent platform",
      title: "Shared capabilities across every module",
      tone: "dark",
      items: [
        {
          title: "Workflow automation",
          description:
            "Automate assignments, approvals, notifications, escalations and recurring business activities.",
        },
        {
          title: "Permissions and access control",
          description:
            "Control access by role, company, department, branch, warehouse, location and responsibility.",
        },
        {
          title: "Approval management",
          description:
            "Create approval rules for purchases, payments, quotations, discounts, expenses and other sensitive actions.",
        },
        {
          title: "Audit history",
          description:
            "Track important changes, approvals, users, dates and transaction history.",
        },
        {
          title: "Documents and attachments",
          description:
            "Store quotations, invoices, contracts, receipts and supporting files with their related business records.",
        },
        {
          title: "Dashboards and reporting",
          description:
            "Give teams and management relevant operational and financial insights.",
        },
        {
          title: "Notifications and tasks",
          description:
            "Keep users informed about pending actions, deadlines, shortages, exceptions and approvals.",
        },
        {
          title: "APIs and integrations",
          description:
            "Connect VercentLabs ERP with approved banking, payment, commerce, logistics, communication and business applications.",
        },
      ],
    },
    {
      eyebrow: "Organisation structure",
      title: "Designed for complex business structures",
      paragraphs: ["Manage operations across:"],
      bullets: [
        "Multiple companies",
        "Branch offices",
        "Warehouses",
        "Manufacturing plants",
        "Retail locations",
        "Departments",
        "Cost centres",
        "Project teams",
        "Shared-service teams",
      ],
    },
    {
      eyebrow: "Complete workflows",
      title: "Connect every department through complete workflows",
      paragraphs: [
        "VercentLabs ERP connects modules through real business processes such as:",
      ],
      bullets: [
        "Lead to cash",
        "Procure to pay",
        "Plan to produce",
        "Inventory to fulfilment",
        "Project to profit",
        "Hire to payroll",
        "Issue to resolution",
        "Asset acquisition to disposal",
      ],
      cta: {
        label: "Explore VercentLabs ERP workflows",
        href: "/workflows",
      },
    },
    {
      eyebrow: "Phased implementation",
      title: "Start with what your business needs",
      paragraphs: [
        "Implement the modules and workflows that solve your highest-priority problems first. Expand the platform as your teams, locations and business processes grow.",
      ],
    },
  ],
  finalCta: {
    title: "Bring every core operation into one connected ERP.",
    description:
      "See how VercentLabs ERP can support your business structure, workflows, approvals, reporting and growth requirements.",
    primary: { label: "Book a personalised demo", href: "/contact" },
    secondary: {
      label: "See how VercentLabs ERP works",
      href: "/how-it-works",
    },
  },
};

export default function ProductPage() {
  return <StructuredContentPage config={config} />;
}
