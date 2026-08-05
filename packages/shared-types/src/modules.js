export const ERP_MODULE_CATALOG = Object.freeze([
  { key: "accounting", name: "Accounting", description: "General ledger, receivables, payables, banking, tax, close and financial reporting.", availability: "released" },
  { key: "procurement", name: "Procurement", description: "Governed supplier lifecycle, sourcing, agreements, purchase orders, receipts and source-to-pay controls.", availability: "released" },
  { key: "sales", name: "Sales", description: "Quotations, approvals, sales orders and governed order-to-cash handoffs.", availability: "released" },
  { key: "crm", name: "CRM", description: "Leads, opportunities, customer relationships and activities.", availability: "released" },
  { key: "stock", name: "Stock", description: "Warehouses, balances, movements, transfers, traceability, replenishment and valuation.", availability: "released" },
  { key: "manufacturing", name: "Manufacturing", description: "BOMs, routings, work centers, material planning, work orders, production execution and costing.", availability: "released" },
  { key: "projects", name: "Projects", description: "Projects, milestones, tasks, resources, time, expenses, budgets, billing and profitability.", availability: "released" },
  { key: "assets", name: "Assets", description: "Asset register, capitalization, custody, maintenance, depreciation, audits, transfers and disposal.", availability: "released" },
  { key: "point-of-sale", name: "Point of Sale", description: "Stores, terminals, checkout, payments, returns, cashier shifts, stock movements and reconciliation.", availability: "released" },
  { key: "quality", name: "Quality", description: "Quality plans, inspections, holds, non-conformance, CAPA, supplier quality, audits and traceability.", availability: "released" },
  { key: "support", name: "Support", description: "Tickets, queues, priorities, SLAs, escalation, ownership, communication, knowledge and customer history.", availability: "released" },
  { key: "hr-payroll", name: "HR & Payroll", description: "Employees, organisation structure, attendance, leave, expenses, compensation, payroll, payslips and statutory controls.", availability: "released" },
].map((module) => Object.freeze(module)));

export const RELEASED_MODULE_KEYS = Object.freeze(
  ERP_MODULE_CATALOG.filter((module) => module.availability === "released").map((module) => module.key),
);

export const ROADMAP_MODULE_KEYS = Object.freeze(
  ERP_MODULE_CATALOG.filter((module) => module.availability === "roadmap").map((module) => module.key),
);

export const TOTAL_MODULE_COUNT = ERP_MODULE_CATALOG.length;
export const RELEASED_MODULE_COUNT = RELEASED_MODULE_KEYS.length;
export const ROADMAP_MODULE_COUNT = ROADMAP_MODULE_KEYS.length;
export const RELEASED_MODULE_NAMES = Object.freeze(
  ERP_MODULE_CATALOG.filter((module) => module.availability === "released").map((module) => module.name),
);
export const RELEASE_STAGE = "controlled-early-access";
export const NATIVE_OPERATIONAL_MODULE_KEYS = Object.freeze(["crm", "procurement"]);

export function getErpModule(key) {
  return ERP_MODULE_CATALOG.find((module) => module.key === key) || null;
}

export function isReleasedModule(key) {
  return RELEASED_MODULE_KEYS.includes(key);
}
