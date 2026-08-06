/**
 * Cross-module workflows evidenced in docs/landing-redesign/phase-1/product-intelligence.md.
 * `modules` values must be valid keys from @vercentlabs/shared-types' ERP_MODULE_CATALOG.
 * `iaPriority` mirrors docs/landing-redesign/phase-1/information-architecture.md's Tier 3 table
 * (only priority P0/P1 workflows have a planned /workflows/{slug} page in the initial IA;
 * the rest are documented here for future phases, not yet routed).
 */
export const LANDING_WORKFLOWS = Object.freeze([
  {
    slug: "lead-to-cash",
    name: "Lead to Cash",
    modules: ["crm", "sales", "accounting"],
    summary:
      "A captured lead converts to an account and opportunity, progresses through a governed pipeline, becomes a publicly accepted quotation, converts to a credit-checked order, and posts a customer invoice.",
    iaPriority: "P0",
  },
  {
    slug: "quote-to-order",
    name: "Quote to Order",
    modules: ["sales", "accounting"],
    summary:
      "A GST-aware quotation is approved, publicly accepted with a typed signature, and converts to a sales order with a real-time customer-credit check.",
    iaPriority: "P0",
  },
  {
    slug: "procure-to-pay",
    name: "Procure to Pay",
    modules: ["procurement", "accounting"],
    summary:
      "A requisition moves through sourcing, award, purchase order, and receipt, and a vendor bill can only be created once two- or three-way matching confirms it.",
    iaPriority: "P0",
  },
  {
    slug: "plan-to-production",
    name: "Plan to Production",
    modules: ["manufacturing", "stock"],
    summary:
      "A bill of materials becomes a work order; release is blocked on component shortage; every material issue and finished-goods receipt posts a real stock movement.",
    iaPriority: "P1",
  },
  {
    slug: "inventory-to-replenishment",
    name: "Inventory to Replenishment",
    modules: ["stock", "procurement"],
    summary: "Reorder rules and a shared, race-safe stock ledger feed replenishment decisions across warehouses.",
    iaPriority: "P1",
  },
  {
    slug: "project-to-profitability",
    name: "Project Planning to Profitability",
    modules: ["projects", "accounting", "hr-payroll"],
    summary:
      "Approved timesheets, expenses, and procurement actuals compute live project gross margin against contracted revenue while the project is still open.",
    iaPriority: "P1",
  },
  {
    slug: "retail-checkout-to-inventory",
    name: "Retail Checkout to Inventory",
    modules: ["point-of-sale", "stock"],
    summary: "A point-of-sale checkout posts the sale and deducts inventory in the same database transaction.",
    iaPriority: "P2",
  },
  {
    slug: "physical-goods-quality-gate",
    name: "Physical-Goods Quality Gate",
    modules: ["quality", "procurement", "manufacturing", "stock", "sales"],
    summary:
      "Inspections tied to receiving, production, stock, or returns can auto-hold inventory on failure; a different person than the inspector must release it.",
    iaPriority: "P2",
  },
  {
    slug: "asset-acquisition-to-disposal",
    name: "Asset Acquisition to Disposal",
    modules: ["assets", "procurement", "stock", "support"],
    summary:
      "An asset referencing its purchase order and receipt moves through capitalization, custodian assignment, maintenance, and disposal, with self-approval blocked at each governed step.",
    iaPriority: "P2",
  },
  {
    slug: "support-ticket-resolution",
    name: "Ticket to Resolution",
    modules: ["support", "crm", "sales", "accounting", "assets", "projects", "quality"],
    summary:
      "A support ticket carries first-class links to the customer's account, sales order, invoice, asset, and project records, aggregated into one customer-history view.",
    iaPriority: "P2",
  },
  {
    slug: "payroll-to-books",
    name: "Governed Payroll to Books",
    modules: ["hr-payroll", "accounting"],
    summary:
      "Attendance-adjusted payroll runs require an approver different from the preparer and post with a manual accounting-batch reference for finance reconciliation.",
    iaPriority: "P2",
  },
  {
    slug: "returns-and-reverse-logistics",
    name: "Returns and Reverse Logistics",
    modules: ["sales", "point-of-sale", "stock", "quality", "accounting"],
    summary:
      "A sales or point-of-sale return restocks inventory, can route through a quality disposition inspection, and flows back through the same receivables/payables documents as the original transaction.",
    iaPriority: "P2",
  },
  {
    slug: "tenant-onboarding-and-entitlement",
    name: "Tenant Onboarding & Module Entitlement",
    modules: ["crm", "sales", "accounting", "procurement", "stock", "manufacturing", "projects", "assets", "point-of-sale", "quality", "support", "hr-payroll"],
    summary:
      "Organisation signup seeds roles and numbering series, activates a verified subscription, and gates every module's access by entitlement.",
    iaPriority: "P2",
  },
]);

export function getWorkflowsForModule(moduleKey) {
  return LANDING_WORKFLOWS.filter((workflow) => workflow.modules.includes(moduleKey));
}
