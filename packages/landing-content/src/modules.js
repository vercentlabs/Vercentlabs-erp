import { ERP_MODULE_CATALOG, getErpModule } from "@vercentlabs/shared-types";

/**
 * Marketing enrichment for each module in ERP_MODULE_CATALOG. `key`, `name`, and
 * `description` are NEVER redefined here — they are always read live from
 * @vercentlabs/shared-types so the marketing site can never drift from the
 * engineering-maintained module catalog. See docs/landing-redesign/phase-1/
 * seo-aeo-geo-architecture.md ("consistent entities").
 *
 * accentColor.sourcedFromProduct: true for the 4 modules with a real, dedicated
 * token in apps/web/src/app/enterprise-modules.css (crm, sales, procurement,
 * accounting). The other 8 are landing-original colors in the same family —
 * never describe them as "the product's colors" in copy.
 */
const MODULE_ENRICHMENT = Object.freeze({
  crm: {
    navGroup: "revenue",
    personas: ["Sales reps and managers", "Marketing ops", "RevOps/leadership", "Compliance/privacy officers"],
    painPoints: [
      "Fragmented lead intake across channels",
      "Leads going stale with no SLA discipline",
      "No unified customer 360",
    ],
    capabilityGroups: [
      "Core lead-to-opportunity engine",
      "Lead acquisition & intelligence",
      "Communications & conversation intelligence",
      "Marketing execution",
      "Customer success & account intelligence",
      "Partner engagement & AI",
    ],
    bestAngle:
      "A public capture form becomes a scored, SLA-tracked lead, converts to an account and opportunity in one step, and syncs offline on mobile with conflict-safe queuing.",
    accentColor: { hex: "#6956d9", soft: "#f2efff", sourcedFromProduct: true },
  },
  sales: {
    navGroup: "revenue",
    personas: ["Sales reps and managers", "Sales ops / finance approvers", "Billing/finance teams"],
    painPoints: [
      "Manual, error-prone GST-aware pricing",
      "Untracked quotation revisions",
      "Orders that exceed customer credit",
    ],
    capabilityGroups: [
      "Quotation pricing & tax engine",
      "Quotation governance & approvals",
      "Order lifecycle & credit control",
      "Fulfillment / invoice handoff",
      "Public quote acceptance",
    ],
    bestAngle:
      "A GST-aware quotation is accepted publicly with a typed signature, converts to an order with a real-time credit check, and hands off to Accounting through an idempotent, auditable request.",
    accentColor: { hex: "#2468d7", soft: "#edf4ff", sourcedFromProduct: true },
  },
  accounting: {
    navGroup: "finance",
    personas: ["Controllers/CFOs", "Accountants/bookkeepers", "AP/AR clerks", "Tax/compliance officers", "Auditors"],
    painPoints: [
      "Spreadsheet-driven month-end close",
      "Duplicate or erroneous payments",
      "Bolt-on GST compliance",
    ],
    capabilityGroups: [
      "General ledger & journals",
      "Receivables",
      "Payables & PO/receipt/invoice matching",
      "Banking & reconciliation",
      "Fixed asset subledger",
      "Tax & compliance (GST/TDS/TCS)",
      "Close, planning & consolidation",
    ],
    bestAngle:
      "Two- and three-way matching gates every accounts-payable posting, and period close is a governed, task-gated workflow that mechanically blocks completion until every exception is resolved.",
    accentColor: { hex: "#31566f", soft: "#edf4f7", sourcedFromProduct: true },
  },
  procurement: {
    navGroup: "operations",
    personas: ["Procurement/purchasing managers", "Sourcing buyers", "Receiving clerks", "AP/finance staff"],
    painPoints: [
      "Maverick / off-contract spend",
      "Supplier risk blind spots",
      "Invoice-to-PO overbilling",
    ],
    capabilityGroups: [
      "Requisition-to-order lifecycle",
      "Sourcing & supplier management",
      "Receiving & matching",
      "Governance / control tower",
      "Spend & risk analytics",
    ],
    bestAngle:
      "An invoice-matching engine mechanically blocks accounts-payable bill creation on unresolved variance, with live readiness scoring across the entire requisition-to-payment chain.",
    accentColor: { hex: "#087f6a", soft: "#eaf8f4", sourcedFromProduct: true },
  },
  stock: {
    navGroup: "operations",
    personas: ["Warehouse/inventory staff", "Inventory planners", "Operations managers"],
    painPoints: [
      "Stockouts and overstock",
      "No multi-warehouse visibility",
      "Batch/serial traceability gaps",
    ],
    capabilityGroups: [
      "Real-time ledger & balances",
      "Movement types (receipt/issue/transfer/adjustment)",
      "Costing & valuation",
      "Traceability & reorder planning",
      "Warehouse & bin structure",
    ],
    bestAngle:
      "One shared, race-safe inventory ledger that Manufacturing and Point of Sale both post into live, with row-locked balance updates that prevent over-issuing.",
    accentColor: { hex: "#b45309", soft: "#fef3e2", sourcedFromProduct: false },
  },
  manufacturing: {
    navGroup: "operations",
    personas: ["Production planners", "Shop-floor supervisors", "Plant managers"],
    painPoints: [
      "Stale or unapproved product structures",
      "Releasing work that can't actually be built",
      "Manual inventory adjustments for production",
    ],
    capabilityGroups: [
      "Bill of materials management",
      "Routings & work centers",
      "Work order lifecycle",
      "Production posting",
      "Material & capacity planning",
      "Costing",
    ],
    bestAngle:
      "A work order cannot be released without proven component availability, and every material issue and finished-goods receipt posts as a real, auditable stock movement.",
    accentColor: { hex: "#c2410c", soft: "#fef0e7", sourcedFromProduct: false },
  },
  projects: {
    navGroup: "delivery",
    personas: ["Project/delivery managers", "Consultants logging time", "Finance/PMO staff"],
    painPoints: [
      "Not knowing project profitability until after close",
      "Double-entering billing into Sales/Accounting",
      "Budget overruns discovered too late",
    ],
    capabilityGroups: [
      "Project setup & staffing",
      "Work breakdown (tasks & milestones)",
      "Time & expense tracking",
      "Budgeting",
      "Profitability & billing",
    ],
    bestAngle:
      "Live gross margin, computed from approved labor, expense, and procurement actuals against contracted revenue, while the project is still open.",
    accentColor: { hex: "#7e22ce", soft: "#f6edfe", sourcedFromProduct: false },
  },
  assets: {
    navGroup: "finance",
    personas: ["Facilities/IT/operations managers", "Maintenance technicians", "Finance/asset controllers"],
    painPoints: [
      "Unclear custody of equipment",
      "Unproven preventive maintenance",
      "Unauditable capitalization and disposal",
    ],
    capabilityGroups: [
      "Asset register & categorization",
      "Capitalization",
      "Assignment & custody",
      "Maintenance",
      "Disposal",
    ],
    bestAngle:
      "Acquisition through capitalization, custodian assignment, maintenance with real labor/parts/external cost capture, and disposal with computed gain or loss — with self-approval blocked at every governed step.",
    accentColor: { hex: "#4d7c0f", soft: "#f2f8e8", sourcedFromProduct: false },
  },
  "point-of-sale": {
    navGroup: "revenue",
    personas: ["Store cashiers/associates", "Shift supervisors", "Store/finance admins"],
    painPoints: [
      "Disconnect between floor sales and back-office stock",
      "Unauthorized over/under-charging",
      "Indefensible end-of-day cash reconciliation",
    ],
    capabilityGroups: [
      "Checkout & cart completion",
      "Shift & cash-drawer control",
      "Returns & refunds",
      "Store/terminal/pricing setup",
      "Reconciliation",
    ],
    bestAngle:
      "Every checkout deducts real inventory in the same database transaction as the sale — no nightly sync, no phantom stock.",
    accentColor: { hex: "#be185d", soft: "#fdf0f5", sourcedFromProduct: false },
  },
  quality: {
    navGroup: "operations",
    personas: ["QA inspectors", "QA managers / release authorities", "Supplier quality managers"],
    painPoints: [
      "Bad material or product silently entering stock or shipping",
      "No segregation of duties between inspection and release",
      "One-off defect notes instead of tracked corrective action",
    ],
    capabilityGroups: [
      "Quality plans & inspection points",
      "Inspection execution & release",
      "Holds & disposition",
      "Non-conformance & CAPA",
      "Supplier quality & audits",
    ],
    bestAngle:
      "The inspector cannot release their own inspection, and a failed inspection automatically places an inventory hold — spanning receiving, production, stock, and returns.",
    accentColor: { hex: "#15803d", soft: "#eaf8ef", sourcedFromProduct: false },
  },
  support: {
    navGroup: "people-and-service",
    personas: ["Support agents", "Team leads / queue managers", "Service ops / CS managers"],
    painPoints: [
      "Silently missed SLA deadlines",
      "Agents lacking commercial context",
      "Tickets closed without documented resolution",
    ],
    capabilityGroups: [
      "Ticket lifecycle",
      "Routing & assignment",
      "SLA management",
      "Communications",
      "Knowledge base",
    ],
    bestAngle:
      "Every ticket automatically carries the customer's commercial context — CRM account, sales order, invoice, asset, and project — through first-class relationship fields.",
    accentColor: { hex: "#b91c1c", soft: "#fdeded", sourcedFromProduct: false },
  },
  "hr-payroll": {
    navGroup: "people-and-service",
    personas: ["HR managers/admins", "Payroll preparers", "Line managers", "Employees"],
    painPoints: [
      "Employee master data in spreadsheets",
      "Manual leave-balance tracking",
      "Error-prone attendance-to-pay math",
    ],
    capabilityGroups: [
      "Workforce structure",
      "Attendance & leave",
      "Compensation & statutory setup",
      "Payroll run processing",
    ],
    bestAngle:
      "Attendance-driven pay calculation with an immutable event trail and hard-coded separation of duties — no one approves their own leave or payroll run.",
    accentColor: { hex: "#a21caf", soft: "#fbeafd", sourcedFromProduct: false },
  },
});

/**
 * The 12 marketing-enriched modules, in ERP_MODULE_CATALOG order. Each entry
 * spreads the canonical catalog fields first so they always win if this file
 * and the catalog ever disagree on a shared key.
 */
export const LANDING_MODULES = Object.freeze(
  ERP_MODULE_CATALOG.map((module) =>
    Object.freeze({
      ...MODULE_ENRICHMENT[module.key],
      ...module,
    }),
  ),
);

export function getLandingModule(key) {
  const erpModule = getErpModule(key);
  if (!erpModule) return null;
  return Object.freeze({ ...MODULE_ENRICHMENT[key], ...erpModule });
}

export function getModulesByNavGroup(navGroup) {
  return LANDING_MODULES.filter((module) => module.navGroup === navGroup);
}
