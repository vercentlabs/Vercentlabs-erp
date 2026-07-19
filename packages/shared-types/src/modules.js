export const ERP_MODULE_CATALOG = Object.freeze([
  { key: "accounting", name: "Accounting", description: "Financial records, receivables, payables and reporting.", availability: "roadmap" },
  { key: "procurement", name: "Procurement", description: "Purchase requests, suppliers, orders and receipts.", availability: "roadmap" },
  { key: "sales", name: "Sales", description: "Quotations, orders, fulfilment and revenue operations.", availability: "roadmap" },
  { key: "crm", name: "CRM", description: "Leads, opportunities, customer relationships and activities.", availability: "released" },
  { key: "stock", name: "Stock", description: "Warehouses, inventory, transfers and traceability.", availability: "roadmap" },
  { key: "manufacturing", name: "Manufacturing", description: "Production planning, materials, operations and costs.", availability: "roadmap" },
  { key: "projects", name: "Projects", description: "Projects, tasks, time, budgets and profitability.", availability: "roadmap" },
  { key: "assets", name: "Assets", description: "Asset lifecycle, depreciation and maintenance.", availability: "roadmap" },
  { key: "point-of-sale", name: "Point of Sale", description: "Counter sales, payments, shifts and returns.", availability: "roadmap" },
  { key: "quality", name: "Quality", description: "Inspections, non-conformances and corrective action.", availability: "roadmap" },
  { key: "support", name: "Support", description: "Customer requests, service targets and resolutions.", availability: "roadmap" },
  { key: "hr-payroll", name: "HR & Payroll", description: "Employees, attendance, leave and payroll.", availability: "roadmap" },
].map((module) => Object.freeze(module)));

export const RELEASED_MODULE_KEYS = Object.freeze(
  ERP_MODULE_CATALOG.filter((module) => module.availability === "released").map((module) => module.key),
);

export const ROADMAP_MODULE_KEYS = Object.freeze(
  ERP_MODULE_CATALOG.filter((module) => module.availability === "roadmap").map((module) => module.key),
);

export function getErpModule(key) {
  return ERP_MODULE_CATALOG.find((module) => module.key === key) || null;
}

export function isReleasedModule(key) {
  return RELEASED_MODULE_KEYS.includes(key);
}
