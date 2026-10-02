/**
 * Glossary — controlled, not hundreds of pages. Every term below gets a
 * real index-card definition on /resources/glossary. Only a term that can
 * clear the full 9-part quality bar (definition, why it matters, how it
 * works, example, related terms, relevant modules, how Vercentlabs handles
 * it, a related workflow, sources) AND connects meaningfully to a real,
 * evidenced Vercentlabs capability gets `standalone: true` and its own
 * /resources/glossary/{slug} page.
 *
 * "Lead to Cash" and "Procure to Pay" are deliberately index-only, not
 * standalone: a full page already exists for each at /workflows/{slug} —
 * a duplicate glossary page would be exactly the cannibalisation
 * scripts/check-cannibalization.mjs guards against. Their index card links
 * straight to the real workflow page instead.
 *
 * Definitions, "why it matters", "how it works" and examples are general,
 * educational ERP content and may describe functionality Vercentlabs ERP
 * doesn't offer. `vercentlabsHandling` is the only product claim on an entry:
 * it must stay inside the approved launch capability register
 * (capabilities/launch-capabilities.js), and says so plainly when a concept is not part of
 * the launch product. Index-only entries only link to a module page when that
 * module actually covers the concept.
 */
export const GLOSSARY_TERMS = Object.freeze([
  // --- Standalone entries (11 pages; Reorder Point & Safety Stock share one) ---
  {
    slug: "erp",
    term: "ERP (Enterprise Resource Planning)",
    shortDefinition: "Business software that runs an organisation's core operational processes — finance, sales, procurement, inventory, manufacturing, HR — on one shared data model instead of separate, disconnected tools.",
    standalone: true,
    definition: "ERP (Enterprise Resource Planning) is a category of business software that unifies an organisation's core operational processes — finance, sales, procurement, inventory, manufacturing, projects, HR, and more — on one shared data model, rather than as separate point tools each keeping their own copy of the truth.",
    whyItMatters: "Without ERP, the same fact (a customer, an item, an order) exists in multiple systems that drift out of sync — a spreadsheet, a separate accounting tool, a separate CRM — and reconciling them consumes real staff time and produces real errors.",
    howItWorks: "Departments read and write the same underlying records rather than syncing copies after the fact — a sales order and the invoice it generates are the same transaction seen from two modules, connected by a real reference, not two documents someone keeps aligned manually.",
    example: "A CRM opportunity becomes a sales quotation; the accepted quotation becomes a sales order; the order is invoiced — one chain of records, not four separately maintained documents.",
    relatedTerms: ["crm", "multi-company-erp", "rbac"],
    relatedModules: ["accounting", "sales", "crm"],
    vercentlabsHandling: "Vercentlabs ERP covers 12 business modules (CRM, Sales, Accounting, Procurement, Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll) on a Shared Platform for tenants and companies, roles and permissions, audit logs, and import and export that every module uses rather than rebuilding.",
    relatedWorkflow: "lead-to-cash",
    lastReviewedAt: "2026-10-02",
  },
  {
    slug: "crm",
    term: "CRM (Customer Relationship Management)",
    shortDefinition: "Software that tracks leads, contacts, accounts, and the sales pipeline — the system a sales team uses to manage relationships and opportunities before a deal is won.",
    standalone: true,
    definition: "CRM (Customer Relationship Management) is software for tracking leads, contacts, accounts, and sales opportunities through a defined pipeline, from first contact through a won or lost decision.",
    whyItMatters: "A CRM that isn't connected to the rest of the business means a won deal has to be re-typed into a separate order or billing system — the exact handoff gap that causes lost deal context and delayed invoicing.",
    howItWorks: "Leads are captured (often with source and campaign attribution), scored, and qualified through pipeline stages; a won opportunity typically becomes the source record for whatever comes next — a quotation, an order — in a connected system.",
    example: "A lead is assigned to a sales rep, qualified through its stages, and converted into an opportunity linked to its account and contact, rather than re-entered by hand at each step.",
    relatedTerms: ["erp"],
    relatedModules: ["crm", "sales"],
    vercentlabsHandling: "CRM is one of Vercentlabs' 12 modules — leads are assigned, qualified, checked for duplicates, and converted into opportunities that move through sales stages, and an opportunity converts into a Sales quotation as part of the Lead to Cash sequence.",
    relatedWorkflow: "lead-to-cash",
    lastReviewedAt: "2026-10-02",
  },
  {
    slug: "mrp",
    term: "MRP (Material Requirements Planning)",
    shortDefinition: "The process of calculating what materials a manufacturer needs to buy or produce, and when, based on demand, existing inventory, and lead times.",
    standalone: true,
    definition: "MRP (Material Requirements Planning) is the calculation process that turns a production plan into a concrete materials plan — determining what to purchase or manufacture, and by when, given current demand, on-hand inventory, and supplier or production lead times.",
    whyItMatters: "Without MRP, materials planning falls back to manual spreadsheet math or gut-feel reordering — a real source of both stockouts (missed a shortage) and excess inventory (over-ordered against a stale estimate).",
    howItWorks: "An MRP run compares a demand signal (sales orders, forecasts, or a production plan) against current stock and open supply, and produces recommended purchase, manufacture, transfer, or expedite actions for each affected item.",
    example: "A production plan for 500 finished units explodes against the bill of materials to determine exactly how many of each component are needed, nets that against on-hand and on-order stock, and recommends a purchase or production action for the shortfall.",
    relatedTerms: ["bom"],
    relatedModules: ["manufacturing", "stock"],
    vercentlabsHandling: "Vercentlabs ERP does not include MRP planning runs at launch. Its Manufacturing module checks material availability for each manufacturing order against the bill of materials, using real-time stock balances — useful input to purchasing decisions, but not an MRP calculation.",
    relatedWorkflow: "plan-to-production",
    lastReviewedAt: "2026-10-02",
  },
  {
    slug: "bom",
    term: "BOM (Bill of Materials)",
    shortDefinition: "The structured list of every component, sub-assembly, and quantity required to manufacture one unit of a finished item.",
    standalone: true,
    definition: "A bill of materials (BOM) is the structured list of every component, sub-assembly, and quantity needed to produce one unit of a finished item — the structural recipe a work order is built from.",
    whyItMatters: "A BOM's accuracy directly determines whether production can run as planned — an incomplete or stale BOM produces a work order that can't actually be fulfilled against real components.",
    howItWorks: "A BOM defines parent-child component relationships and quantities per unit; when a work order is created, its materials and operations are typically snapshotted from the active BOM at that moment, not re-read live from a structure that could change mid-order.",
    example: "A finished product's BOM lists 6 components at specific quantities each; a manufacturing order for 100 units uses the BOM to work out how much of each component is needed and whether it's available.",
    relatedTerms: ["mrp"],
    relatedModules: ["manufacturing"],
    vercentlabsHandling: "In Vercentlabs ERP, manufacturing orders are created from an item's bill of materials, and material availability is checked against it before production starts; material issue, consumption, and scrap are then recorded against the order.",
    relatedWorkflow: "plan-to-production",
    lastReviewedAt: "2026-10-02",
  },
  {
    slug: "reorder-point-and-safety-stock",
    term: "Reorder Point & Safety Stock",
    shortDefinition: "Reorder point is the inventory level that triggers a replenishment order; safety stock is the buffer quantity held to protect against demand or supply variability.",
    standalone: true,
    definition: "A reorder point is the on-hand inventory level that should trigger a new purchase or production order. Safety stock is the buffer quantity kept above expected need to absorb demand spikes or supplier delays. The two are usually set together: reorder point = expected usage during lead time + safety stock.",
    whyItMatters: "Set too low, both cause stockouts that halt fulfilment or production; set too high, both tie up working capital in inventory that isn't moving — getting this pair right is a real, continuous operational decision, not a one-time setting.",
    howItWorks: "A reorder rule is typically attached to an item (and often a preferred supplier), and a dashboard or report surfaces items that have crossed their reorder point so a buyer can act.",
    example: "An item with a reorder point of 50 units and safety stock of 20 shows on a low-stock dashboard the moment on-hand quantity drops to 50, giving the buyer visibility before the buffer is touched.",
    relatedTerms: ["purchase-requisition"],
    relatedModules: ["stock", "procurement"],
    vercentlabsHandling: "Vercentlabs ERP does not include reorder rules or automatic replenishment at launch. Real-time stock balances and available stock give buyers current figures, and replenishment is a deliberate purchasing decision raised as a purchase order.",
    relatedWorkflow: "procure-to-pay",
    lastReviewedAt: "2026-10-02",
  },
  {
    slug: "three-way-match",
    term: "Three-Way Match",
    shortDefinition: "A procurement control that compares the purchase order, the goods receipt, and the vendor invoice before a bill is approved for payment — catching discrepancies before money moves.",
    standalone: true,
    definition: "Three-way matching is a procurement control that compares three documents — the purchase order (what was ordered), the goods receipt (what actually arrived), and the vendor invoice (what's being billed) — and only allows payment processing once they agree within tolerance.",
    whyItMatters: "Without matching, an organisation pays whatever a vendor invoices, even if it doesn't reflect what was actually ordered or received — a real source of overpayment and undetected billing errors.",
    howItWorks: "The three documents are compared line by line; a variance outside an allowed tolerance is flagged as an exception requiring a documented reason before it can be overridden, rather than silently approved.",
    example: "A purchase order for 100 units, a receipt confirming 100 units delivered, and a vendor invoice billing for 100 units at the agreed price match cleanly and clear for payment; an invoice billing for 105 units would be held as a variance exception.",
    relatedTerms: ["purchase-requisition"],
    relatedModules: ["procurement", "accounting"],
    vercentlabsHandling: "Vercentlabs ERP supports 2-way matching (supplier invoice against the purchase order) and 3-way matching (purchase order, goods receipt, and supplier invoice) before a supplier invoice is posted to payables and paid.",
    relatedWorkflow: "procure-to-pay",
    lastReviewedAt: "2026-10-02",
  },
  {
    slug: "purchase-requisition",
    term: "Purchase Requisition",
    shortDefinition: "An internal request to buy goods or services, the first step in a governed procure-to-pay process before sourcing or a purchase order exists.",
    standalone: true,
    definition: "A purchase requisition is an internal request from an employee or department to buy goods or services — the starting document in a procurement process, distinct from the purchase order that later goes to a supplier.",
    whyItMatters: "Requiring a requisition before a purchase order gives an organisation a governed checkpoint — someone requests, someone else (by policy) approves — rather than any employee committing company spend directly to a supplier.",
    howItWorks: "A requisition typically moves through a state machine (draft, submitted, approved, executed) before it can become a purchase order, with the option to route through competitive sourcing (RFQ/bids) for larger or non-routine spend.",
    example: "An employee drafts a requisition for replacement equipment; it's submitted, approved by a designated approver (not the requester), and only then does a buyer convert it into a purchase order sent to a supplier.",
    relatedTerms: ["three-way-match"],
    relatedModules: ["procurement"],
    vercentlabsHandling: "Vercentlabs ERP does not include purchase requisitions at launch. Purchasing starts from the purchase order, which is then received against a goods receipt and matched against the supplier invoice.",
    relatedWorkflow: "procure-to-pay",
    lastReviewedAt: "2026-10-02",
  },
  {
    slug: "rbac",
    term: "RBAC (Role-Based Access Control)",
    shortDefinition: "An access-control model where permissions are granted to roles rather than individual users, and users gain permissions by being assigned to a role.",
    standalone: true,
    definition: "RBAC (role-based access control) is an access-control model where permissions are attached to roles (e.g. \"Sales Approver,\" \"Payroll Preparer\") rather than to individual user accounts, and a user gains those permissions by being assigned the role.",
    whyItMatters: "Managing access at the role level, not per-user, is what makes access reviews and audits actually tractable at scale — an auditor can review 12 role definitions instead of every individual user's ad hoc permission grants.",
    howItWorks: "A well-implemented RBAC system typically supports scoping a role assignment to a specific part of the organisation (a company, branch, or department) and time-bounding it with a start and expiry date, so temporary access doesn't become permanent by accident.",
    example: "A contractor is granted a scoped role limited to one branch, with an expiry date matching their engagement end — their access is automatically no longer valid after that date, without anyone having to remember to revoke it.",
    relatedTerms: ["maker-checker", "multi-company-erp"],
    relatedModules: ["accounting", "hr-payroll"],
    vercentlabsHandling: "Vercentlabs ERP uses roles and permissions checked on the server, with record-level access and company and branch access to narrow what each user can reach.",
    relatedWorkflow: null,
    lastReviewedAt: "2026-10-02",
  },
  {
    slug: "maker-checker",
    term: "Maker-Checker",
    shortDefinition: "A control where the person who creates or prepares a transaction cannot also be the one who approves it — also called segregation of duties.",
    standalone: true,
    definition: "Maker-checker (also called segregation of duties) is a control principle where the person who creates or prepares a transaction — the \"maker\" — cannot also be the person who approves it — the \"checker.\"",
    whyItMatters: "This is one of the most common audit findings when it's missing: a payroll run, a journal entry, or a purchase order approved by the same person who created it, with no independent check — a real fraud and error-detection gap.",
    howItWorks: "Enforced properly, this is a structural rule in the permission model — the system itself blocks a maker from also acting as checker on the same transaction, rather than relying on a written policy someone could bypass under time pressure.",
    example: "A payroll preparer calculates and submits a run; the system requires a different, designated approver before it can post — the preparer's own approval action on that same run is rejected outright, not merely discouraged.",
    relatedTerms: ["rbac"],
    relatedModules: ["hr-payroll", "accounting", "projects"],
    vercentlabsHandling: "In Vercentlabs ERP, leave approval and payroll approval are built in: nobody can decide their own leave request, and an approver can't approve a payroll that includes their own pay. Vercentlabs ERP does not include a general-purpose approval engine at launch.",
    relatedWorkflow: "hire-to-payroll",
    lastReviewedAt: "2026-10-02",
  },
  {
    slug: "multi-tenant-saas",
    term: "Multi-Tenant SaaS",
    shortDefinition: "A software architecture where multiple customer organisations (tenants) share the same application infrastructure while their data stays structurally isolated from each other.",
    standalone: true,
    definition: "Multi-tenant SaaS is a software architecture where multiple customer organisations (\"tenants\") run on shared application infrastructure, with each tenant's data kept structurally isolated from every other tenant.",
    whyItMatters: "The isolation has to be structural, not just a filtered view in the application layer — a query scoped incorrectly in a multi-tenant system is a real data-leak risk between customers, not a cosmetic bug.",
    howItWorks: "Tenant boundaries are typically enforced at the database and access-control layer, so even a coding mistake in one feature can't easily leak data across tenants — isolation that doesn't depend on every developer remembering to filter correctly.",
    example: "Two unrelated companies both use the same ERP instance; a user from one can never see, query, or be granted access to the other's records, regardless of role, because the isolation is enforced below the application logic, not just within it.",
    relatedTerms: ["multi-company-erp"],
    relatedModules: ["accounting"],
    vercentlabsHandling: "Vercentlabs ERP is multi-tenant: each organisation's data is isolated by database row-level security on its tenant tables. Within an organisation, company and branch access is scoped through permissions and query-level controls in the application.",
    relatedWorkflow: null,
    lastReviewedAt: "2026-10-02",
  },
  {
    slug: "multi-company-erp",
    term: "Multi-Company ERP",
    shortDefinition: "ERP software that supports running more than one legal entity, plant, or branch on one platform, with each entity's data structurally separated while still allowing consolidated reporting when needed.",
    standalone: true,
    definition: "Multi-company ERP is ERP software built to run more than one legal entity, plant, or branch on a single platform — with each entity's data and user access structurally separated, while still supporting a consolidated view when one is needed.",
    whyItMatters: "The real test isn't whether a second company record can exist — it's whether a user's access is genuinely scoped to only the companies or branches they're granted, and whether that access can be time-bound rather than permanent by default.",
    howItWorks: "A real multi-company implementation typically models organisations, companies, branches, and departments as a genuine hierarchy with scoped role assignments, plus a separate consolidation capability that rolls up multiple entities' books without breaking each entity's own independently accurate records.",
    example: "A distributor running four warehouses under one legal entity gives its branch managers access scoped to their own branch, while finance retains a consolidated view across all four for close and reporting.",
    relatedTerms: ["multi-tenant-saas", "rbac"],
    relatedModules: ["accounting"],
    vercentlabsHandling: "Vercentlabs ERP lets an organisation run several companies and branches, with access scoped by company and branch. Financial consolidation and intercompany accounting are not part of the launch product.",
    relatedWorkflow: null,
    lastReviewedAt: "2026-10-02",
  },
  // --- Index-only entries (16; linked to a page only where Vercentlabs ERP covers the concept) ---
  { term: "Routing", shortDefinition: "The sequence of operations (and the work centers/time each requires) needed to convert raw materials into a finished item — the process complement to a BOM's materials list.", standalone: false },
  { term: "Work Order", shortDefinition: "A trackable instruction to produce a specific quantity of an item, built from its bill of materials — called a manufacturing order in Vercentlabs ERP.", standalone: false, relatedRoute: "/workflows/plan-to-production" },
  { term: "Lead to Cash", shortDefinition: "The end-to-end process from capturing a sales lead through qualification, quotation, order confirmation, and invoicing.", standalone: false, relatedRoute: "/workflows/lead-to-cash" },
  { term: "Procure to Pay", shortDefinition: "The end-to-end purchasing process — from the decision to buy, through purchase order, receipt, invoice matching, and payment.", standalone: false, relatedRoute: "/workflows/procure-to-pay" },
  { term: "Order to Cash", shortDefinition: "The process from a confirmed sales order through warehouse fulfilment to invoicing — the fulfilment and billing half of the broader lead-to-cash cycle.", standalone: false, relatedRoute: "/workflows/order-to-fulfilment" },
  { term: "Available to Promise (ATP)", shortDefinition: "A calculation of how much of an item can be committed to a new order, based on on-hand stock minus what's already reserved or allocated to other orders.", standalone: false, relatedRoute: "/modules/stock" },
  { term: "Stock Ledger", shortDefinition: "The system of record for every inventory movement — receipts, issues, transfers, adjustments — that determines an item's real-time on-hand quantity and valuation.", standalone: false, relatedRoute: "/modules/stock" },
  { term: "Lot/Serial Tracking", shortDefinition: "Tracking inventory at the level of individual batches (lot tracking) or individual units (serial tracking), typically for traceability, recall, or warranty purposes.", standalone: false },
  { term: "Cycle Count", shortDefinition: "A periodic, partial physical inventory count of a subset of items, used to verify system-recorded quantities against reality without a full warehouse shutdown.", standalone: false, relatedRoute: "/modules/stock" },
  { term: "RFQ (Request for Quotation)", shortDefinition: "A formal invitation sent to suppliers to submit pricing and terms for a defined scope of goods or services, typically used for competitively sourced spend.", standalone: false },
  { term: "CAPA (Corrective and Preventive Action)", shortDefinition: "A formal, tracked process for investigating a quality failure, fixing its immediate cause (corrective) and its root cause (preventive) so it doesn't recur.", standalone: false },
  { term: "Non-Conformance", shortDefinition: "A recorded instance where a product, material, or process fails to meet a defined quality specification — the triggering event for a quality hold and a disposition decision.", standalone: false, relatedRoute: "/modules/quality" },
  { term: "OEE (Overall Equipment Effectiveness)", shortDefinition: "A manufacturing metric combining availability, performance, and quality into a single score representing how effectively a piece of equipment or line is being used.", standalone: false },
  { term: "WIP (Work in Progress)", shortDefinition: "Inventory that has entered the production process but isn't yet a finished good — materials that have been issued to a work order but not yet completed.", standalone: false, relatedRoute: "/modules/manufacturing" },
  { term: "Depreciation", shortDefinition: "The systematic allocation of a fixed asset's cost over its useful life, reducing its recorded book value over time as it's used.", standalone: false, relatedRoute: "/modules/assets" },
  { term: "SLA (Service-Level Agreement)", shortDefinition: "A defined commitment for how quickly a support request will be responded to or resolved, typically measured and tracked against a due date.", standalone: false },
]);

export const STANDALONE_GLOSSARY_SLUGS = Object.freeze(
  GLOSSARY_TERMS.filter((entry) => entry.standalone).map((entry) => entry.slug),
);

export function getGlossaryTerm(slug) {
  return GLOSSARY_TERMS.find((entry) => entry.slug === slug) || null;
}
