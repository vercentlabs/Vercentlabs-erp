export type ErpModule = {
  slug: string;
  name: string;
  summary: string;
  outcome: string;
  capabilities: string[];
  releaseNote?: string;
};

export type BusinessFlow = {
  name: string;
  summary: string;
  stages: string[];
};

export type Industry = {
  slug: string;
  name: string;
  description: string;
  challenges: string[];
  capabilities: string[];
  releaseNote?: string;
};

export const erpModules: ErpModule[] = [
  {
    slug: "accounting",
    name: "Accounting",
    summary:
      "Operate core ledgers, journals, receivables, payables, banking records, budgets, close and reporting controls from governed operational data.",
    outcome:
      "Give finance teams a traceable accounting core while statutory provider workflows remain explicitly separate.",
    capabilities: [
      "General ledger, journals and chart of accounts",
      "Receivables, payables, receipts and payments",
      "Bank statement and reconciliation foundations",
      "Budgets, close and financial reporting controls",
    ],
    releaseNote:
      "Available as controlled early-access web scope. India e-Invoice, E-Way Bill, GST return filing and other provider-backed statutory workflows are not yet released.",
  },
  {
    slug: "procurement",
    name: "Procurement",
    summary:
      "Manage governed supplier records, requisitions, sourcing, purchase orders, receipts and matching foundations.",
    outcome:
      "Control selected source-to-pay handoffs while supplier portals, budget enforcement and stock-backed execution continue to mature.",
    capabilities: [
      "Supplier records and governance",
      "Requisitions, approvals and sourcing events",
      "Purchase orders, amendments and receipts",
      "Matching foundations and Accounting handoff",
    ],
    releaseNote:
      "Available as controlled early-access web scope with selected native dashboard access. Full supplier onboarding, budget checks, supplier portal and stock-backed matching are not yet released.",
  },
  {
    slug: "sales",
    name: "Sales",
    summary:
      "Create versioned quotations and governed sales orders with approvals, customer decisions and Accounting handoffs.",
    outcome:
      "Create a controlled quotation-to-order core without claiming stock-backed fulfilment or returns that are not yet released.",
    capabilities: [
      "Versioned quotations and customer decisions",
      "Pricing, tax and approval evidence",
      "Sales-order conversion and lifecycle controls",
      "Invoice-request handoff and sales reporting",
    ],
    releaseNote:
      "Available as controlled early-access web scope. Stock-backed fulfilment, reservations, pick-pack-ship, returns, sales contracts and recurring billing are not yet released.",
  },
  {
    slug: "crm",
    name: "CRM",
    summary:
      "Manage leads, opportunities, activities, pipelines and customer history beside delivery and financial context.",
    outcome: "Help commercial teams act with governed customer context.",
    capabilities: [
      "Lead and opportunity management",
      "Pipeline stages and activities",
      "Customer interaction history",
      "Forecasting and sales handoff",
    ],
    releaseNote:
      "Available as controlled early-access web and native scope. Live email, calendar, telephony and messaging integrations require external provider configuration; advanced account/contact merge and intelligence remain under development.",
  },
  {
    slug: "stock",
    name: "Stock",
    summary:
      "Track stock, warehouses, batches, serial numbers, transfers, replenishment and valuation in real time.",
    outcome:
      "Maintain reliable availability while reducing shortages and excess stock.",
    capabilities: [
      "Multi-warehouse stock control",
      "Batch and serial traceability",
      "Transfers and replenishment",
      "Valuation and movement history",
    ],
  },
  {
    slug: "manufacturing",
    name: "Manufacturing",
    summary:
      "Plan materials, bills of material, work orders, capacity, production and shop-floor execution.",
    outcome:
      "Connect demand, materials, production progress and cost in one controlled process.",
    capabilities: [
      "Bills of material and routings",
      "Material and production planning",
      "Work orders and shop-floor activity",
      "Production cost and variance visibility",
    ],
  },
  {
    slug: "projects",
    name: "Projects",
    summary:
      "Plan work, milestones, tasks, time, expenses, resources, billing and project profitability.",
    outcome:
      "Connect delivery progress with commercial and financial performance.",
    capabilities: [
      "Projects, milestones and tasks",
      "Time, expense and resource tracking",
      "Project purchasing and billing",
      "Budget and profitability visibility",
    ],
  },
  {
    slug: "assets",
    name: "Assets",
    summary:
      "Manage the lifecycle of equipment and fixed assets from acquisition through use, maintenance and disposal.",
    outcome:
      "Improve accountability, maintenance planning and financial control over assets.",
    capabilities: [
      "Asset register and assignment",
      "Depreciation and accounting handoff",
      "Maintenance schedules and history",
      "Transfer, audit and disposal controls",
    ],
  },
  {
    slug: "point-of-sale",
    name: "Point of Sale",
    summary:
      "Process store transactions, payments, returns, cash shifts and stock movements through a connected POS.",
    outcome:
      "Keep retail sales, inventory and accounting aligned across locations.",
    capabilities: [
      "Fast checkout and payment capture",
      "Returns, discounts and cash shifts",
      "Store and terminal controls",
      "Real-time stock and accounting updates",
    ],
  },
  {
    slug: "quality",
    name: "Quality",
    summary:
      "Define inspections, quality plans, non-conformance, corrective action and traceability across operations.",
    outcome:
      "Build repeatable quality control into purchasing, production and fulfilment.",
    capabilities: [
      "Quality plans and inspection points",
      "Incoming, in-process and final checks",
      "Non-conformance and corrective action",
      "Traceability and quality reporting",
    ],
  },
  {
    slug: "support",
    name: "Support",
    summary:
      "Manage tickets, priorities, service levels, assignments, knowledge and customer communication.",
    outcome:
      "Resolve customer issues with clear ownership and complete operational context.",
    capabilities: [
      "Ticket intake and categorisation",
      "Queues, priorities and ownership",
      "Service targets and escalation",
      "Knowledge and customer history",
    ],
  },
  {
    slug: "hr-payroll",
    name: "HR & Payroll",
    summary:
      "Manage employee records, attendance, leave, payroll, expenses, performance and workforce reporting.",
    outcome:
      "Connect people operations and payroll with secure controls and financial handoff.",
    capabilities: [
      "Employee records and organisation structure",
      "Attendance, shifts and leave",
      "Payroll, deductions and payslips",
      "Performance, expenses and workforce reports",
    ],
  },
];

export const businessFlows: BusinessFlow[] = [
  {
    name: "Lead to cash",
    summary:
      "Turn an opportunity into an order, delivery, invoice, payment and customer history.",
    stages: [
      "Lead",
      "Quotation",
      "Sales order",
      "Fulfilment",
      "Invoice",
      "Payment",
    ],
  },
  {
    name: "Procure to pay",
    summary:
      "Move from an approved requirement to supplier selection, receipt, matching and payment.",
    stages: [
      "Request",
      "Approval",
      "Purchase order",
      "Receipt",
      "Supplier invoice",
      "Payment",
    ],
  },
  {
    name: "Plan to produce",
    summary:
      "Translate demand into materials, capacity, work orders, quality checks and finished stock.",
    stages: [
      "Demand",
      "Plan",
      "Materials",
      "Production",
      "Quality",
      "Finished stock",
    ],
  },
  {
    name: "Stock to fulfilment",
    summary:
      "Control availability, reservation, picking, dispatch, returns and stock valuation.",
    stages: ["Availability", "Reserve", "Pick", "Dispatch", "Return", "Value"],
  },
  {
    name: "Project to profit",
    summary:
      "Connect scope, work, resources, cost, billing and project margin.",
    stages: ["Scope", "Plan", "Deliver", "Track cost", "Bill", "Review margin"],
  },
  {
    name: "Hire to pay",
    summary:
      "Manage employee onboarding, attendance, leave, payroll, accounting and workforce reporting.",
    stages: ["Hire", "Onboard", "Attend", "Approve", "Payroll", "Report"],
  },
];

export const industries: Industry[] = [
  {
    slug: "manufacturing",
    name: "Manufacturing",
    description:
      "Connect demand, procurement, stock, production, quality, maintenance, sales and finance.",
    challenges: [
      "Material availability and production visibility",
      "Quality and traceability across batches",
      "Actual production cost and margin",
    ],
    capabilities: [
      "Planning and work orders",
      "Batch and serial traceability",
      "Quality control and asset maintenance",
      "Production costing and financial posting",
    ],
  },
  {
    slug: "distribution",
    name: "Distribution",
    description:
      "Coordinate purchasing, multi-warehouse stock, pricing, sales orders, fulfilment and collections.",
    challenges: [
      "Availability across warehouses",
      "Complex pricing and customer commitments",
      "Fast fulfilment with accurate margin",
    ],
    capabilities: [
      "Multi-warehouse inventory",
      "Procurement and replenishment",
      "Sales order fulfilment",
      "Credit, collections and margin reporting",
    ],
  },
  {
    slug: "retail",
    name: "Retail",
    description:
      "Unify point of sale, store stock, purchasing, pricing, returns, customers and finance.",
    challenges: [
      "Store and central inventory alignment",
      "Fast checkout and return control",
      "Location-level sales and margin visibility",
    ],
    capabilities: [
      "Connected point of sale",
      "Store and warehouse stock",
      "Pricing, promotions and returns",
      "Daily financial and operational reporting",
    ],
  },
  {
    slug: "professional-services",
    name: "Professional Services",
    description:
      "Connect CRM, proposals, projects, resources, time, expenses, billing and profitability.",
    challenges: [
      "Sales-to-delivery handoff",
      "Resource and milestone visibility",
      "Accurate project billing and margin",
    ],
    capabilities: [
      "CRM and proposal management",
      "Projects, tasks and resources",
      "Time, expense and billing",
      "Project profitability reporting",
    ],
  },
  {
    slug: "construction",
    name: "Construction and Contracting",
    description:
      "Control project budgets, procurement, materials, subcontracting, assets, billing and cost.",
    challenges: [
      "Project-wise material and cost control",
      "Supplier and subcontractor coordination",
      "Progress billing and cash visibility",
    ],
    capabilities: [
      "Project budgets and cost codes",
      "Site procurement and stock",
      "Asset and subcontractor tracking",
      "Progress billing and margin analysis",
    ],
  },
  {
    slug: "multi-company",
    name: "Multi-company Groups",
    description:
      "Operate multiple companies, locations and business units with shared governance and controlled reporting.",
    challenges: [
      "Consistent master data and permissions",
      "Company-specific operations and controls",
      "Group visibility without losing accountability",
    ],
    capabilities: [
      "Company and location boundaries",
      "Shared roles and approval policies",
      "Inter-company operating flows",
      "Consolidated management visibility",
    ],
  },
];

export function getModule(slug: string) {
  return erpModules.find((erpModule) => erpModule.slug === slug);
}

export function getIndustry(slug: string) {
  return industries.find((industry) => industry.slug === slug);
}
