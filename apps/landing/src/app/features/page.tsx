import { createPageMetadata } from "@/lib/metadata";

import StructuredContentPage, {
  type ContentItem,
  type StructuredPageConfig,
} from "@/components/marketing/structured-content-page";

export const metadata = createPageMetadata({
  title:
    "VercentLabs ERP Features | Automation, Control, Reporting and Integrations",
  description:
    "Explore implemented platform and CRM capabilities, together with a clearly labelled roadmap for additional ERP modules.",
  path: "/features",
});

const items = (entries: Array<[string, string]>): ContentItem[] =>
  entries.map(([title, description]) => ({ title, description }));

const config: StructuredPageConfig = {
  hero: {
    eyebrow: "Platform Features",
    title:
      "The capabilities your teams need to operate with clarity and control.",
    description:
      "VercentLabs ERP currently combines authentication, permissions, audit foundations, master data, CRM and billing capabilities. Additional operational modules remain clearly labelled roadmap scope.",
    primary: { label: "Book a feature walkthrough", href: "/contact" },
    secondary: { label: "Explore the product", href: "/product" },
  },
  sections: [
    {
      title: "Business data management",
      items: items([
        [
          "Shared master data",
          "Maintain consistent customer, supplier, product, employee, account, asset and location records across the platform.",
        ],
        [
          "Duplicate prevention",
          "Reduce repeated and conflicting records through controlled master-data management.",
        ],
        [
          "Custom fields",
          "Capture organisation-specific information without creating disconnected spreadsheets.",
        ],
        [
          "Record relationships",
          "Connect customers, orders, invoices, stock movements, projects, employees and support requests.",
        ],
        [
          "Data import and export",
          "Move approved business data through controlled import and export processes.",
        ],
        [
          "Data validation",
          "Apply required fields, formats, business rules and transaction validations.",
        ],
      ]),
    },
    {
      title: "Workflow and automation",
      items: items([
        [
          "Configurable workflows",
          "Configure business stages around your operating process.",
        ],
        [
          "Automatic assignments",
          "Assign activities based on department, role, location, customer, product or transaction type.",
        ],
        [
          "Multi-level approvals",
          "Create approval chains based on value, authority, department or business condition.",
        ],
        [
          "Notifications and reminders",
          "Inform users about pending work, deadlines, approvals and exceptions.",
        ],
        [
          "Escalation rules",
          "Escalate overdue or unresolved activities to the appropriate person.",
        ],
        [
          "Recurring activities",
          "Automate repeated transactions, tasks, reminders and operational routines.",
        ],
        [
          "Business rules",
          "Apply conditions that determine what users can do and what happens next.",
        ],
      ]),
    },
    {
      title: "Access and security",
      tone: "dark",
      items: items([
        [
          "Role-based access",
          "Give users access according to their responsibilities.",
        ],
        [
          "Company-level access",
          "Restrict or allow information across different legal entities.",
        ],
        [
          "Branch and location access",
          "Control visibility across branches, warehouses, plants and retail locations.",
        ],
        [
          "Field and action control",
          "Control who can view, create, edit, approve, cancel or delete business information.",
        ],
        [
          "Separation of duties",
          "Separate sensitive activities such as creation, approval and payment.",
        ],
        [
          "Secure sessions",
          "Protect user access through controlled authentication and session management.",
        ],
      ]),
    },
    {
      title: "Approvals and governance",
      items: items([
        [
          "Approval limits",
          "Set approval authority according to transaction value or business responsibility.",
        ],
        [
          "Delegation",
          "Delegate approvals during planned absence or operational reassignment.",
        ],
        [
          "Rejection and revision",
          "Return transactions for correction with clear reasons and history.",
        ],
        [
          "Policy enforcement",
          "Require supporting documents, validations or approvals before completion.",
        ],
        [
          "Audit trails",
          "Track important changes, actions, approvals, users and dates.",
        ],
        [
          "Period controls",
          "Restrict transactions within closed or controlled accounting periods.",
        ],
      ]),
    },
    {
      title: "Dashboards and reporting",
      items: items([
        [
          "Role-based dashboards",
          "Show each user the activities and information relevant to their work.",
        ],
        [
          "Operational dashboards",
          "Monitor sales, purchases, inventory, production, projects, workforce and support.",
        ],
        [
          "Financial reporting",
          "Review receivables, payables, cash position, expenses, revenue and profitability.",
        ],
        [
          "Drill-down reporting",
          "Move from summary information to the related business transactions.",
        ],
        [
          "Filters and dimensions",
          "Analyse information by company, branch, department, project, product, customer or period.",
        ],
        ["Scheduled reports", "Deliver recurring reports to approved users."],
        [
          "Exportable reports",
          "Export authorised information for further analysis or compliance needs.",
        ],
      ]),
    },
    {
      title: "Documents and communication",
      items: items([
        [
          "Transaction attachments",
          "Attach contracts, quotations, invoices, receipts, certificates and supporting files.",
        ],
        [
          "Document templates",
          "Create consistent quotations, purchase orders, invoices, payslips and other business documents.",
        ],
        [
          "Activity history",
          "Maintain notes, tasks, interactions and follow-up history.",
        ],
        [
          "Internal comments",
          "Allow teams to communicate within the relevant business record.",
        ],
        [
          "Customer and supplier communication",
          "Maintain communication context with the related transaction.",
        ],
        [
          "Document numbering",
          "Configure controlled numbering for important business documents.",
        ],
      ]),
    },
    {
      title: "Inventory and traceability",
      items: items([
        [
          "Multi-warehouse management",
          "Manage inventory across multiple warehouses and operating locations.",
        ],
        ["Batch tracking", "Track products by batch or lot."],
        [
          "Serial-number tracking",
          "Maintain individual product identity and movement history.",
        ],
        [
          "Reorder management",
          "Create replenishment requirements based on stock rules.",
        ],
        [
          "Inventory reservations",
          "Reserve available inventory against confirmed demand.",
        ],
        [
          "Stock valuation",
          "Maintain the financial value of inventory movements.",
        ],
        ["Transfer tracking", "Monitor stock transfers between locations."],
        [
          "Return management",
          "Control customer, supplier and internal stock returns.",
        ],
      ]),
    },
    {
      title: "Multi-company and multi-location operations",
      tone: "dark",
      items: items([
        [
          "Multiple companies",
          "Manage separate legal entities within the same platform.",
        ],
        [
          "Shared or separate master data",
          "Control which information is shared across companies.",
        ],
        [
          "Intercompany operations",
          "Support controlled transactions between related organisations.",
        ],
        [
          "Multiple branches",
          "Represent branch-specific users, operations and reporting.",
        ],
        [
          "Multiple warehouses",
          "Maintain warehouse-specific inventory and responsibilities.",
        ],
        [
          "Consolidated reporting",
          "Review information across selected companies and locations.",
        ],
      ]),
    },
    {
      title: "Collaboration and productivity",
      items: items([
        [
          "Personal task lists",
          "Give users visibility into their pending responsibilities.",
        ],
        [
          "Team activities",
          "Coordinate work across departments and process stages.",
        ],
        [
          "Mentions and notifications",
          "Bring the right users into relevant business conversations.",
        ],
        [
          "Due dates and priorities",
          "Organise work by importance and deadline.",
        ],
        [
          "Saved views",
          "Allow users to save useful filters and working views.",
        ],
        [
          "Global search",
          "Find authorised customers, suppliers, products, transactions and documents.",
        ],
        [
          "Mobile-responsive access",
          "Use VercentLabs ERP across desktop, tablet and mobile devices.",
        ],
      ]),
    },
    {
      title: "Integrations and extensibility",
      items: items([
        [
          "Secure APIs",
          "Connect approved external systems through controlled application interfaces.",
        ],
        [
          "Webhooks and business events",
          "Notify external systems when approved business events occur.",
        ],
        [
          "Banking and payments",
          "Connect supported banking and payment services.",
        ],
        [
          "Commerce integrations",
          "Connect approved online commerce or marketplace systems.",
        ],
        [
          "Communication integrations",
          "Connect supported email, messaging and notification services.",
        ],
        [
          "Logistics integrations",
          "Exchange approved delivery and shipment information.",
        ],
        [
          "Data migration tools",
          "Import information from spreadsheets, legacy systems and other ERP products.",
        ],
        [
          "Extension-ready architecture",
          "Expand capabilities without bypassing platform security and business controls.",
        ],
      ]),
    },
    {
      title: "Reliability and administration",
      items: items([
        [
          "System health monitoring",
          "Monitor important application and service conditions.",
        ],
        ["Error tracking", "Identify and investigate application failures."],
        [
          "Backup management",
          "Maintain controlled backups according to the deployment architecture.",
        ],
        [
          "Configuration management",
          "Maintain organisation, module and workflow settings.",
        ],
        [
          "User administration",
          "Create, deactivate and manage users and responsibilities.",
        ],
        [
          "Change management",
          "Control important configuration and deployment changes.",
        ],
        [
          "Environment separation",
          "Maintain appropriate development, testing and production environments.",
        ],
      ]),
    },
    {
      title: "User experience",
      items: items([
        [
          "Consistent navigation",
          "Use the same interaction patterns across every module.",
        ],
        [
          "Role-focused workspaces",
          "Show users the information and actions relevant to their responsibilities.",
        ],
        [
          "Responsive design",
          "Access important activities across different screen sizes.",
        ],
        [
          "Clear status indicators",
          "Understand the current state of every transaction.",
        ],
        [
          "Helpful validation",
          "Receive clear guidance when information is missing or invalid.",
        ],
        [
          "Accessible interaction",
          "Support keyboard navigation, readable contrast and understandable controls.",
        ],
        [
          "Fast search and filtering",
          "Find relevant records without manually reviewing long lists.",
        ],
      ]),
    },
  ],
  finalCta: {
    title: "Explore the features that power every VercentLabs ERP module.",
    description:
      "See how automation, permissions, approvals, reporting and integrations can support your organisation.",
    primary: { label: "Book a feature walkthrough", href: "/contact" },
    secondary: { label: "Explore the module roadmap", href: "/modules" },
  },
};

export default function FeaturesPage() {
  return <StructuredContentPage config={config} />;
}
