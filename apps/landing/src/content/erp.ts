export type ErpModule = {
  slug: string;
  name: string;
  summary: string;
  outcome: string;
  capabilities: string[];
};

export const erpModules: ErpModule[] = [
  {
    slug: "accounting",
    name: "Accounting",
    summary:
      "Manage ledgers, receivables, payables, taxes, banking, fixed assets and financial reporting from connected business transactions.",
    outcome:
      "Close books faster with traceable entries generated from real operational activity.",
    capabilities: [
      "General ledger and chart of accounts",
      "Accounts receivable and payable",
      "Bank reconciliation and cash visibility",
      "Tax-ready invoicing and compliance workflows",
      "Budgets, cost centres and financial statements",
      "Period close, controls and audit history",
    ],
  },
  {
    slug: "procurement",
    name: "Procurement",
    summary:
      "Control purchase requests, approvals, supplier quotations, purchase orders, receipts and invoice matching.",
    outcome:
      "Buy the right materials at the right time with clear ownership, approval and spend visibility.",
    capabilities: [
      "Purchase requests and approval chains",
      "Supplier quotation comparison",
      "Purchase orders and delivery schedules",
      "Goods receipt and quality handoff",
      "Three-way matching",
      "Supplier performance and spend analysis",
    ],
  },
  {
    slug: "sales",
    name: "Sales",
    summary:
      "Move from quotation to confirmed order, fulfilment, invoicing and collection without re-entering business data.",
    outcome:
      "Give sales and operations one reliable view of demand, commitment, fulfilment and revenue.",
    capabilities: [
      "Quotations and pricing rules",
      "Sales orders and approval controls",
      "Availability and delivery commitments",
      "Dispatch and fulfilment tracking",
      "Invoice and collection handoff",
      "Sales performance reporting",
    ],
  },
  {
    slug: "crm",
    name: "CRM",
    summary:
      "Manage leads, accounts, contacts, opportunities, activities and customer history before an order is created.",
    outcome:
      "Turn follow-up discipline and customer context into a predictable sales pipeline.",
    capabilities: [
      "Lead capture and qualification",
      "Account and contact management",
      "Opportunity pipeline",
      "Tasks, meetings and follow-ups",
      "Sales forecasting",
      "CRM-to-quotation conversion",
    ],
  },
  {
    slug: "stock",
    name: "Stock",
    summary:
      "Track items across warehouses, locations, batches, serial numbers, transfers, reservations and replenishment.",
    outcome:
      "Know what is available, committed, moving and at risk across every location.",
    capabilities: [
      "Multi-warehouse stock visibility",
      "Receipts, issues and transfers",
      "Batch and serial tracking",
      "Reservations and available-to-promise",
      "Reorder rules and replenishment",
      "Stock valuation and movement history",
    ],
  },
  {
    slug: "manufacturing",
    name: "Manufacturing",
    summary:
      "Plan materials, bills of materials, work orders, operations, capacity, consumption and finished production.",
    outcome:
      "Connect demand, material availability, shop-floor execution and production cost in one flow.",
    capabilities: [
      "Bills of materials and routings",
      "Production planning",
      "Work orders and operations",
      "Material issue and consumption",
      "Capacity and work-centre visibility",
      "Production cost and output tracking",
    ],
  },
  {
    slug: "projects",
    name: "Projects",
    summary:
      "Plan work, resources, time, expenses, milestones, billing and profitability for internal and customer projects.",
    outcome:
      "Keep delivery, utilisation, cost, billing and margin visible throughout every project.",
    capabilities: [
      "Projects, milestones and tasks",
      "Resource planning",
      "Timesheets and expenses",
      "Project procurement",
      "Milestone or time-based billing",
      "Project cost and profitability",
    ],
  },
  {
    slug: "assets",
    name: "Assets",
    summary:
      "Manage the lifecycle of equipment, facilities and capital assets from acquisition through maintenance and disposal.",
    outcome:
      "Protect asset value with clear ownership, maintenance history and financial traceability.",
    capabilities: [
      "Asset register and classification",
      "Assignment and location history",
      "Preventive maintenance schedules",
      "Breakdown and service records",
      "Depreciation integration",
      "Transfer, retirement and disposal",
    ],
  },
  {
    slug: "point-of-sale",
    name: "Point of Sale",
    summary:
      "Run counter sales, payments, returns, shifts and store stock with direct accounting and inventory integration.",
    outcome:
      "Give retail teams a fast checkout while keeping stock, cash and finance accurate.",
    capabilities: [
      "Fast product search and checkout",
      "Cash, card and digital payments",
      "Discount and pricing controls",
      "Returns and exchanges",
      "Shift and cash-drawer reconciliation",
      "Real-time stock and accounting updates",
    ],
  },
  {
    slug: "quality",
    name: "Quality",
    summary:
      "Define inspections, quality plans, test results, non-conformances, corrective actions and release controls.",
    outcome:
      "Prevent defects from moving forward and create an evidence trail for every quality decision.",
    capabilities: [
      "Incoming, in-process and final inspections",
      "Quality plans and checkpoints",
      "Test results and specifications",
      "Non-conformance management",
      "Corrective and preventive actions",
      "Quality release and audit records",
    ],
  },
  {
    slug: "support",
    name: "Support",
    summary:
      "Manage customer tickets, service levels, assignments, communication, resolution and complete account context.",
    outcome:
      "Resolve issues faster with ownership, priority, history and business context in one place.",
    capabilities: [
      "Ticket intake and categorisation",
      "Priority, assignment and escalation",
      "Service-level tracking",
      "Customer and transaction context",
      "Knowledge and standard responses",
      "Resolution and support analytics",
    ],
  },
  {
    slug: "hr-payroll",
    name: "HR & Payroll",
    summary:
      "Manage employee records, attendance, leave, payroll, reimbursements, documents and workforce reporting.",
    outcome:
      "Run people operations and payroll through controlled, employee-centred workflows.",
    capabilities: [
      "Employee records and organisation structure",
      "Attendance, shifts and leave",
      "Payroll calculation and review",
      "Reimbursements and employee requests",
      "Documents and lifecycle workflows",
      "Workforce and payroll reporting",
    ],
  },
];

export const businessFlows = [
  {
    name: "Lead to Cash",
    summary:
      "Connect customer acquisition, selling, fulfilment, invoicing and collection.",
    stages: [
      "CRM",
      "Quotation",
      "Sales order",
      "Fulfilment",
      "Invoice",
      "Collection",
    ],
  },
  {
    name: "Procure to Pay",
    summary:
      "Connect internal demand, supplier selection, purchasing, receipt and payment.",
    stages: [
      "Request",
      "Approval",
      "Quotation",
      "Purchase order",
      "Receipt",
      "Payment",
    ],
  },
  {
    name: "Plan to Produce",
    summary:
      "Connect demand, materials, capacity, production, quality and finished stock.",
    stages: ["Demand", "Plan", "Materials", "Work order", "Quality", "Output"],
  },
  {
    name: "Project to Profit",
    summary:
      "Connect opportunity, project delivery, time, cost, billing and margin.",
    stages: [
      "Opportunity",
      "Project",
      "Resources",
      "Delivery",
      "Billing",
      "Margin",
    ],
  },
  {
    name: "Hire to Retire",
    summary:
      "Connect employee onboarding, attendance, payroll, requests and exit.",
    stages: ["Hire", "Onboard", "Attendance", "Payroll", "Develop", "Exit"],
  },
  {
    name: "Issue to Resolution",
    summary:
      "Connect customer support intake, ownership, service activity and resolution.",
    stages: ["Ticket", "Triage", "Assign", "Investigate", "Resolve", "Learn"],
  },
];

export const industries = [
  {
    slug: "manufacturing",
    name: "Manufacturing",
    description:
      "Connect demand, procurement, stock, production, quality, assets, people and finance.",
    challenges: [
      "Material shortages and changing schedules",
      "Weak work-in-progress visibility",
      "Disconnected quality and cost records",
    ],
    capabilities: [
      "BOM, routing and production planning",
      "Batch, serial and warehouse control",
      "Inspection and non-conformance workflows",
      "Production cost and financial integration",
    ],
  },
  {
    slug: "distribution",
    name: "Distribution and Wholesale",
    description:
      "Coordinate suppliers, warehouses, pricing, sales orders, fulfilment, credit and collections.",
    challenges: [
      "Stock spread across locations",
      "Pricing and margin inconsistency",
      "Delayed fulfilment and collection visibility",
    ],
    capabilities: [
      "Multi-warehouse stock",
      "Customer and supplier pricing",
      "Order allocation and dispatch",
      "Credit, invoicing and collection controls",
    ],
  },
  {
    slug: "retail",
    name: "Retail",
    description:
      "Connect point of sale, store stock, purchasing, returns, customer history and finance.",
    challenges: [
      "Store and central stock mismatch",
      "Slow reconciliation",
      "Limited customer and margin visibility",
    ],
    capabilities: [
      "Integrated point of sale",
      "Store replenishment",
      "Returns and exchange workflows",
      "Daily cash and accounting reconciliation",
    ],
  },
  {
    slug: "professional-services",
    name: "Professional Services",
    description:
      "Connect CRM, proposals, projects, resources, time, expenses, billing and profitability.",
    challenges: [
      "Weak resource visibility",
      "Unbilled time and expenses",
      "Disconnected sales and delivery",
    ],
    capabilities: [
      "Opportunity-to-project conversion",
      "Resource and milestone planning",
      "Time, expense and approval workflows",
      "Project billing and margin reporting",
    ],
  },
  {
    slug: "construction",
    name: "Construction and Contracting",
    description:
      "Coordinate project budgets, materials, procurement, assets, labour, progress billing and finance.",
    challenges: [
      "Project cost overruns",
      "Decentralised material control",
      "Delayed progress and billing information",
    ],
    capabilities: [
      "Project budget and commitment control",
      "Site stock and procurement",
      "Asset and workforce allocation",
      "Progress billing and cost reporting",
    ],
  },
  {
    slug: "service-operations",
    name: "Service Operations",
    description:
      "Connect customer agreements, support, field work, projects, assets, billing and workforce operations.",
    challenges: [
      "Fragmented customer service history",
      "Unclear ownership and response times",
      "Manual service billing",
    ],
    capabilities: [
      "Ticket and service workflows",
      "Customer, asset and transaction context",
      "Project and workforce coordination",
      "Service billing and profitability",
    ],
  },
];

export const frequentlyAskedQuestions = [
  {
    question: "Can we start with selected modules?",
    answer:
      "Yes. Vercent ERP is modular. Begin with the workflows that create the greatest operational value, then add modules without rebuilding the business foundation.",
  },
  {
    question: "Does Vercent ERP support multiple companies and locations?",
    answer:
      "Yes. Company, branch, warehouse, department and shared-service structures can be represented with scoped access and reporting.",
  },
  {
    question: "How is existing data migrated?",
    answer:
      "The implementation process covers source assessment, cleansing, mapping, rehearsal, reconciliation and controlled cutover.",
  },
  {
    question: "Can workflows and approvals be configured?",
    answer:
      "Yes. Roles, approval steps, responsibilities, exceptions and business rules can be configured around the organisation's operating model.",
  },
  {
    question: "How do the 12 modules stay connected?",
    answer:
      "They share governed master data, permissions, documents, workflow events and reporting so a transaction can move across departments without repeated entry.",
  },
  {
    question: "What is the next step?",
    answer:
      "Book a product demo. We will review your current systems, priority workflows, organisation structure and implementation goals.",
  },
];

export function getModule(slug: string) {
  return erpModules.find((item) => item.slug === slug);
}

export function getIndustry(slug: string) {
  return industries.find((item) => item.slug === slug);
}
