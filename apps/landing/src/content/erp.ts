export type ErpModule = {
  slug: string;
  name: string;
  summary: string;
  outcome: string;
  capabilities: string[];
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
};

export const erpModules: ErpModule[] = [
  {
    slug: "platform-admin",
    name: "Platform and Administration",
    summary:
      "Manage organisations, users, permissions, workflows, audit history and shared master data from one secure foundation.",
    outcome:
      "Create consistent controls across companies, teams, locations and business units.",
    capabilities: [
      "Multi-company and multi-location structures",
      "Role-based access control",
      "Approval workflow configuration",
      "Audit history and master data governance",
    ],
  },
  {
    slug: "finance",
    name: "Finance and Accounting",
    summary:
      "Connect accounting, receivables, payables, cash, taxes, assets and financial reporting with operational activity.",
    outcome:
      "Give finance teams a current and traceable view of business performance.",
    capabilities: [
      "General ledger and chart of accounts",
      "Accounts receivable and payable",
      "Cash, bank and payment operations",
      "Tax, assets and financial reporting",
    ],
  },
  {
    slug: "procurement",
    name: "Procurement",
    summary:
      "Control purchasing from requisition and approval through purchase orders, receipts, invoices and supplier performance.",
    outcome:
      "Reduce uncontrolled buying and improve visibility across supplier commitments.",
    capabilities: [
      "Purchase requisitions and approvals",
      "Supplier and quotation management",
      "Purchase orders and receipts",
      "Three-way matching and supplier analysis",
    ],
  },
  {
    slug: "inventory",
    name: "Inventory and Warehousing",
    summary:
      "Track stock, warehouses, batches, serial numbers, transfers, replenishment and valuation in real time.",
    outcome:
      "Maintain reliable stock positions while reducing shortages and excess inventory.",
    capabilities: [
      "Multi-warehouse stock control",
      "Batch and serial traceability",
      "Transfers and replenishment",
      "Stock valuation and movement history",
    ],
  },
  {
    slug: "sales",
    name: "Sales and Order Management",
    summary:
      "Manage quotations, contracts, sales orders, fulfilment, invoicing, returns and customer commitments.",
    outcome:
      "Create a connected order-to-cash process with fewer manual handoffs.",
    capabilities: [
      "Quotations and pricing",
      "Sales orders and fulfilment",
      "Customer credit and commitments",
      "Returns, invoicing and order visibility",
    ],
  },
  {
    slug: "crm",
    name: "Customer Relationship Management",
    summary:
      "Organise leads, opportunities, activities, pipelines and customer history alongside delivery and financial information.",
    outcome:
      "Help commercial teams work with a complete view of each customer relationship.",
    capabilities: [
      "Lead and opportunity pipelines",
      "Tasks, meetings and activities",
      "Customer account history",
      "Forecasting and conversion visibility",
    ],
  },
  {
    slug: "manufacturing",
    name: "Manufacturing",
    summary:
      "Plan materials, bills of materials, work orders, production, quality and shop-floor execution.",
    outcome:
      "Align demand, materials, capacity and production activity in one operational system.",
    capabilities: [
      "Bills of materials and routings",
      "Material requirements planning",
      "Work orders and production tracking",
      "Quality, scrap and production costing",
    ],
  },
  {
    slug: "hr-payroll",
    name: "People and Payroll",
    summary:
      "Manage employee records, attendance, leave, expenses, payroll inputs and workforce processes.",
    outcome:
      "Give employees and HR teams consistent, controlled people operations.",
    capabilities: [
      "Employee records and organisation structure",
      "Attendance and leave",
      "Expenses and approvals",
      "Payroll inputs and workforce reporting",
    ],
  },
  {
    slug: "projects-services",
    name: "Projects and Services",
    summary:
      "Plan projects, assign resources, capture time and costs, manage milestones and connect delivery with billing.",
    outcome:
      "Improve control over project margins, utilisation and customer delivery.",
    capabilities: [
      "Project planning and milestones",
      "Resource allocation",
      "Time, expense and cost tracking",
      "Project billing and margin visibility",
    ],
  },
  {
    slug: "analytics-reporting",
    name: "Analytics and Reporting",
    summary:
      "Bring operational and financial information together through dashboards, reports, alerts and governed metrics.",
    outcome:
      "Enable leaders to act from shared and traceable business information.",
    capabilities: [
      "Role-based dashboards",
      "Operational and financial reports",
      "Alerts and exception monitoring",
      "Shared metrics and drill-down analysis",
    ],
  },
];

export const businessFlows: BusinessFlow[] = [
  {
    name: "Lead to Cash",
    summary:
      "Connect prospect activity with quotations, orders, fulfilment, invoicing and payment collection.",
    stages: [
      "Lead",
      "Opportunity",
      "Quotation",
      "Sales order",
      "Fulfilment",
      "Invoice",
      "Payment",
    ],
  },
  {
    name: "Procure to Pay",
    summary:
      "Control demand, approvals, supplier selection, purchasing, receipt, invoice matching and payment.",
    stages: [
      "Requirement",
      "Requisition",
      "Approval",
      "Purchase order",
      "Receipt",
      "Supplier invoice",
      "Payment",
    ],
  },
  {
    name: "Plan to Produce",
    summary:
      "Translate demand into material planning, work orders, production, quality checks and finished stock.",
    stages: [
      "Demand",
      "Planning",
      "Material requirement",
      "Work order",
      "Production",
      "Quality",
      "Finished goods",
    ],
  },
  {
    name: "Record to Report",
    summary:
      "Capture operational transactions, reconcile accounts, close periods and produce reliable reporting.",
    stages: [
      "Transaction",
      "Posting",
      "Reconciliation",
      "Adjustments",
      "Period close",
      "Reporting",
    ],
  },
  {
    name: "Hire to Retire",
    summary:
      "Coordinate employee onboarding, work records, attendance, development, payroll inputs and offboarding.",
    stages: [
      "Recruitment",
      "Onboarding",
      "Employee record",
      "Attendance",
      "Development",
      "Payroll",
      "Offboarding",
    ],
  },
];

export const industries: Industry[] = [
  {
    slug: "manufacturing",
    name: "Manufacturing",
    description:
      "Connect demand, procurement, materials, production, quality, inventory, costing and finance.",
    challenges: [
      "Disconnected production and inventory data",
      "Weak material and capacity visibility",
      "Manual production costing",
    ],
    capabilities: [
      "Bills of materials and routings",
      "Material requirements planning",
      "Work-order execution",
      "Quality and production costing",
    ],
  },
  {
    slug: "distribution",
    name: "Wholesale and Distribution",
    description:
      "Coordinate purchasing, warehouse operations, pricing, orders, fulfilment, credit and collections.",
    challenges: [
      "Stock spread across multiple locations",
      "Complex customer pricing",
      "Limited fulfilment visibility",
    ],
    capabilities: [
      "Multi-warehouse inventory",
      "Customer and supplier pricing",
      "Order fulfilment",
      "Credit and collection controls",
    ],
  },
  {
    slug: "retail",
    name: "Retail and Commerce",
    description:
      "Unify products, inventory, locations, purchasing, customer operations and financial reporting.",
    challenges: [
      "Fragmented location data",
      "Slow replenishment decisions",
      "Inconsistent product information",
    ],
    capabilities: [
      "Product and catalogue governance",
      "Location-level inventory",
      "Replenishment workflows",
      "Sales and margin reporting",
    ],
  },
  {
    slug: "professional-services",
    name: "Professional Services",
    description:
      "Manage opportunities, projects, resources, time, expenses, billing, utilisation and margins.",
    challenges: [
      "Weak project profitability visibility",
      "Manual time and expense processes",
      "Disconnected sales and delivery teams",
    ],
    capabilities: [
      "Opportunity-to-project conversion",
      "Resource planning",
      "Time and expense capture",
      "Project billing and margins",
    ],
  },
  {
    slug: "construction",
    name: "Construction and Contracting",
    description:
      "Coordinate projects, budgets, procurement, contractors, materials, progress, billing and finance.",
    challenges: [
      "Project cost overruns",
      "Decentralised procurement",
      "Delayed progress and billing information",
    ],
    capabilities: [
      "Project budgets and controls",
      "Site and material visibility",
      "Contractor and procurement workflows",
      "Progress billing and cost reporting",
    ],
  },
  {
    slug: "healthcare-operations",
    name: "Healthcare Operations",
    description:
      "Support controlled procurement, inventory, assets, workforce operations, finance and auditability.",
    challenges: [
      "Sensitive access requirements",
      "Critical inventory availability",
      "Complex operational approvals",
    ],
    capabilities: [
      "Role-based operational access",
      "Batch and expiry tracking",
      "Procurement controls",
      "Asset and financial reporting",
    ],
  },
];

export const frequentlyAskedQuestions = [
  {
    question: "Who is the design-partner programme for?",
    answer:
      "It is intended for growing Indian manufacturers, distributors and service businesses with an important workflow split across spreadsheets or disconnected applications.",
  },
  {
    question: "Can we begin with one workflow or selected modules?",
    answer:
      "Yes. The recommended approach is to define the smallest valuable end-to-end scope, validate it with real users and expand through controlled releases.",
  },
  {
    question: "What does a design partner contribute?",
    answer:
      "A design partner provides access to process owners, realistic business scenarios, current-system context and structured feedback. Participation does not automatically create a production contract.",
  },
  {
    question: "How is existing data handled?",
    answer:
      "Implementation planning includes source review, ownership, cleansing, mapping, migration rehearsal, reconciliation and controlled cutover before production use.",
  },
  {
    question: "Can the platform represent multiple companies and locations?",
    answer:
      "Multi-company, multi-location and shared-service structures are part of the intended platform foundation and must be validated against the organisation's actual control model.",
  },
  {
    question: "Is public production access available today?",
    answer:
      "Public self-service production access is not currently offered. Suitable applications begin with a fit review and may proceed to discovery or a controlled pilot.",
  },
];

export function getModule(slug: string) {
  return erpModules.find((item) => item.slug === slug);
}

export function getIndustry(slug: string) {
  return industries.find((item) => item.slug === slug);
}
