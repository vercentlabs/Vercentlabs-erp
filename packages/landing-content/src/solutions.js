import { CTAS } from "./navigation.js";

/**
 * Solution pages — problem-led entry points that go deeper than the homepage's
 * problem section and link to ONE paired platform page
 * (relatedPlatformPageSlug) for the underlying capability, never restating it.
 *
 * Every approach[] claim must stay inside the approved launch capability
 * register (capabilities/launch-capabilities.js). screenshotId is optional and only set
 * where an approved screenshot honestly illustrates the page's approach.
 */
export const LANDING_SOLUTIONS = Object.freeze([
  {
    slug: "replace-spreadsheets",
    name: "Replace Spreadsheets",
    directDefinition:
      "Replacing spreadsheets with Vercentlabs ERP means shared master data, validated forms, document numbering, and a protected audit log in place of the item, customer, and pricing files departments currently maintain separately.",
    problemStatement:
      "Your item list lives in one spreadsheet, your customers in another, your invoice numbering is a manually incremented cell, and every one of them drifts out of sync the moment two people edit at once.",
    before: "Item codes, customers, and prices re-typed across three or four spreadsheets, with no single version anyone fully trusts — and no record of who changed what, when.",
    after: "One item master and one customer and supplier master shared by every module — Sales, Procurement, Stock, and Manufacturing — with validated forms instead of a shared file someone else has open.",
    approach: [
      { title: "Item, customer, and supplier data becomes one master", description: "The item master, customer master, and supplier master are shared by every module that needs them — not a workbook copied between departments.", moduleKey: "stock" },
      { title: "Manual numbering becomes document numbering", description: "Invoices, orders, and other documents take their numbers from configured numbering series — no more manually incremented cell that someone eventually gets wrong." },
      { title: "A version-history column becomes a protected audit log", description: "Significant actions are recorded in a platform audit log, and the database rejects any attempt to edit or delete an entry." },
      { title: "Formula-driven totals become calculated values", description: "Discounts, taxes, stock balances, and inventory valuation are calculated by the system from live records, not a spreadsheet formula that breaks when a column is inserted." },
    ],
    relatedPlatformPageSlug: "/product",
    relatedModuleKeys: ["stock", "sales", "procurement"],
    relatedWorkflowSlugs: ["procure-to-pay"],
    screenshotId: "sales-quotation-detail",
    faqs: [
      { question: "How much of our existing spreadsheet data moves across?", answer: "Data migration is planned and checked as part of implementation — see the implementation journey's data-migration phase — and CSV import with a preview and rollback step is available for CRM leads." },
      { question: "Will the team lose the flexibility a spreadsheet gives them?", answer: "Validated forms replace free-form cell edits, which is a real trade-off — you lose ad hoc editing in exchange for data every module can trust. Most teams make this switch because the free-form editing was already the problem." },
      { question: "What if our processes don't match a standard module exactly?", answer: "Implementation's configuration phase sets up numbering, roles, permissions, and module settings to match your real process — see the implementation journey for what's configurable at that stage." },
    ],
    metaDescription: "See what replaces your item, customer, and pricing spreadsheets: shared master data, validated forms, document numbering, and a protected audit log — not another file someone else has open.",
    searchIntent: "replace spreadsheets with ERP software",
    conversion: { heading: "See your spreadsheet processes become one connected system.", ctaLabel: CTAS.talkToSpecialist.label },
  },
  {
    slug: "connect-business-operations",
    name: "Connect Business Operations",
    directDefinition:
      "Connecting business operations with Vercentlabs ERP means CRM, Sales, Stock, Procurement, and Accounting working on the same records at each handoff — not synced copies reconciled between separate tools.",
    problemStatement:
      "Purchasing doesn't know what sales just promised a customer. The warehouse doesn't know what purchasing just ordered. Every handoff between departments is a re-typed email or a chat message, not a system that already knows.",
    before: "An opportunity, a quotation, a purchase order, and an invoice exist as four records in four tools, connected only by someone remembering to update all four.",
    after: "One connected data model where an opportunity converts into a quotation, the quotation becomes an order that reserves real stock, and the invoice posts to the general ledger — the same records, not four copies.",
    approach: [
      { title: "CRM to Sales without re-typing", description: "An opportunity converts into a Sales quotation, so the customer and deal details carry straight through to the order and invoice.", moduleKey: "crm" },
      { title: "Sales orders see real stock", description: "Sales orders check availability and reserve stock from the same balances the warehouse works from.", moduleKey: "sales" },
      { title: "Procurement to Accounting is checked, not assumed", description: "Supplier invoices are matched 2-way against the purchase order, or 3-way against the order and goods receipt, before they're posted and paid.", moduleKey: "procurement" },
      { title: "Support works from the same customer", description: "Support tickets are logged against the same customers and contacts the revenue team works with, so agents and sales share one customer record.", moduleKey: "support" },
    ],
    relatedPlatformPageSlug: "/product/platform",
    relatedModuleKeys: ["crm", "sales", "procurement", "support"],
    relatedWorkflowSlugs: ["lead-to-cash", "procure-to-pay"],
    screenshotId: "sales-order-detail",
    faqs: [
      { question: "Does every module talk to every other module automatically?", answer: "No — the connections are real but specific, not an all-to-all mesh. Each module page's 'Connected modules' section describes exactly which records it shares and with whom." },
      { question: "How is this different from buying integration middleware for our existing tools?", answer: "Middleware connects separate systems after the fact, with sync lag and conflicts to resolve. Here, CRM, Sales, Stock, Procurement, and Accounting are modules of one system with one data model, so these handoffs don't need a sync step." },
      { question: "What sits underneath these module handoffs?", answer: "See the Platform page for the Shared Platform every module runs on — tenants and companies, users, roles and permissions, audit logs, and the transaction safety that keeps records consistent." },
    ],
    metaDescription: "See how Vercentlabs connects CRM, Sales, Stock, Procurement, and Accounting on one data model — an opportunity becomes a quotation, an order, and an invoice without being re-typed.",
    searchIntent: "connect business operations software",
    conversion: { heading: "See a lead become an invoice without a single re-typed handoff.", ctaLabel: CTAS.talkToSpecialist.label },
  },
  {
    slug: "multi-company-management",
    name: "Multi-Company Management",
    directDefinition:
      "Managing multiple companies with Vercentlabs ERP means several companies and branches in one organisation, with roles, permissions, and company and branch access deciding who sees what — relevant to a manufacturer with several plants or a distributor with several warehouses, not just a holding-company structure.",
    problemStatement:
      "You run more than one legal entity, plant, or branch, and today that means either a separate system per entity or one shared login where anyone can see everyone else's numbers.",
    before: "Either a separate system per company that never lines up with the others, or one shared system with no real separation — every user sees every company's data whether they should or not.",
    after: "One platform with several companies and branches, where each user's access is scoped to the companies and branches they're granted.",
    approach: [
      { title: "Companies and branches in one organisation", description: "An organisation can run several companies and branches, each with its own company settings for currency, timezone, tax configuration, and document numbering." },
      { title: "Access scoped by company and branch", description: "Company and branch access is scoped through permissions and query-level controls in the application, so a user only reaches the companies and branches they've been granted." },
      { title: "Roles and record-level access on top", description: "Roles and permissions decide what each user can do, and record-level access narrows which records they reach within their companies." },
      { title: "Each company keeps its own books", description: "Accounting keeps the chart of accounts, general ledger, and financial statements for the business on the same platform as every other module.", moduleKey: "accounting" },
    ],
    relatedPlatformPageSlug: "/product/platform",
    relatedModuleKeys: ["accounting"],
    relatedWorkflowSlugs: [],
    faqs: [
      { question: "Can a user work across two companies if their role genuinely requires it?", answer: "Yes — company and branch access is granted per user, so someone who genuinely needs more than one company can be given access to each." },
      { question: "Does Vercentlabs consolidate the books of several companies?", answer: "No. The launch product doesn't include financial consolidation or intercompany accounting." },
      { question: "Is company separation enforced in the database?", answer: "Tenant (organisation) isolation is enforced by database row-level security. Company and branch access within an organisation is enforced by permissions and query-level controls in the application." },
    ],
    metaDescription: "See how Vercentlabs runs several companies and branches in one organisation, with roles, permissions, record-level access, and company and branch access scoping who sees what.",
    searchIntent: "multi-company ERP software",
    conversion: { heading: "See access scoped across every company you run.", ctaLabel: CTAS.talkToSpecialist.label },
  },
  {
    slug: "workflow-automation",
    name: "Built-In Workflow Controls",
    directDefinition:
      "Workflow control with Vercentlabs ERP means the system enforcing specific rules inside everyday work — duplicate detection, stock reservation, negative-stock control, quality holds, invoice matching, and leave and payroll approval — not a drag-and-drop workflow builder you configure yourself.",
    problemStatement:
      "Stock gets promised twice. Goods that failed inspection get shipped. A supplier invoice gets paid for goods that never arrived. The parts of your process that should be enforced keep depending on someone remembering.",
    before: "Stock checked by walking the warehouse, failed goods flagged on a sticky note, supplier invoices paid on trust, and leave and payroll signed off in email.",
    after: "Sales orders reserve real stock, issues below zero are blocked, quality holds stop stock from moving, supplier invoices are matched before payment, and leave and payroll are approved in the system.",
    approach: [
      { title: "Stock can't be promised twice", description: "Sales orders check availability and reserve stock, and negative-stock control blocks issues that would take a balance below zero.", moduleKey: "stock" },
      { title: "Failed goods can't move", description: "A quality hold blocks stock movement until the hold is released, so stock that failed inspection isn't shipped or used by mistake.", moduleKey: "quality" },
      { title: "Supplier invoices are checked before payment", description: "Supplier invoices are matched 2-way against the purchase order, or 3-way against the order and goods receipt.", moduleKey: "procurement" },
      { title: "Leave and payroll are approved in the system", description: "Leave requests and payroll are approved in Vercentlabs ERP, and an approver can't approve a payroll that includes their own pay.", moduleKey: "hr-payroll" },
    ],
    relatedPlatformPageSlug: "/product/automation",
    relatedModuleKeys: ["stock", "quality", "hr-payroll"],
    relatedWorkflowSlugs: ["procure-to-pay", "hire-to-payroll"],
    screenshotId: "quality-dashboard",
    faqs: [
      { question: "Is this a general-purpose workflow builder we configure ourselves?", answer: "No — these are specific controls built into the modules (stock reservation, negative-stock control, quality holds, invoice matching, leave and payroll approval), not a drag-and-drop workflow designer." },
      { question: "Is there a general approval engine for discounts, purchases, and journals?", answer: "No. Approvals at launch are built into specific capabilities — leave approval and payroll approval — rather than a general-purpose approval engine." },
      { question: "Does Vercentlabs schedule recurring postings or reorders automatically?", answer: "No. The launch product doesn't include scheduled recurring postings, automatic reordering, or MRP planning runs." },
    ],
    metaDescription: "See the controls Vercentlabs ERP enforces inside everyday work: stock reservation, negative-stock control, quality holds, supplier invoice matching, and leave and payroll approval.",
    searchIntent: "business process automation software",
    conversion: { heading: "See what stops needing a human to catch it.", ctaLabel: CTAS.talkToSpecialist.label },
  },
  {
    slug: "real-time-business-reporting",
    name: "Real-Time Business Reporting",
    directDefinition:
      "Real-time reporting with Vercentlabs ERP means reports come straight from the records every module works on — financial statements from the general ledger, stock balances from the stock ledger, and day-end totals from the till — not a scheduled data-warehouse refresh.",
    problemStatement:
      "Sales, finance, and operations each keep their own version of the numbers, refreshed whenever someone remembers to update the spreadsheet — usually right before the numbers are needed.",
    before: "A trial balance rebuilt from exports, a stock count only as current as the last walk-through, and a pipeline kept in personal lists.",
    after: "The trial balance, profit & loss, and balance sheet straight from the general ledger; real-time stock balances by warehouse; the opportunity pipeline by sales stage; and the Day-End / Z report for every shift.",
    approach: [
      { title: "Financial statements from the ledger", description: "The trial balance, profit & loss, and balance sheet are produced from the double-entry general ledger, not re-assembled by hand.", moduleKey: "accounting" },
      { title: "Stock balances that are actually current", description: "Real-time stock balances and the inventory movement history update as each receipt, issue, transfer, and adjustment posts.", moduleKey: "stock" },
      { title: "A pipeline everyone reads the same way", description: "The opportunity pipeline shows open deals by sales stage, from the same records sales reps work in.", moduleKey: "crm" },
      { title: "Day-end totals from the till", description: "The Day-End / Z report and payment reconciliation total each shift's takings by payment method.", moduleKey: "point-of-sale" },
    ],
    relatedPlatformPageSlug: "/product/analytics",
    relatedModuleKeys: ["accounting", "stock", "crm", "point-of-sale"],
    relatedWorkflowSlugs: ["order-to-fulfilment"],
    screenshotId: "stock-overview",
    faqs: [
      { question: "Is 'real-time' actually real-time, or refreshed on a schedule?", answer: "Reports read the operational records directly — a posted journal or a stock movement is reflected the next time the relevant report runs, not the next morning." },
      { question: "Can we export data for our own BI tool?", answer: "CSV export is available today for CRM leads; see the reporting and data import & export pages for the current scope." },
      { question: "Do different departments really see the same numbers?", answer: "Yes. Reports trace back to the same order, invoice, and stock records every module works on, not separately maintained copies." },
    ],
    metaDescription: "See real-time reporting in Vercentlabs ERP: financial statements from the general ledger, real-time stock balances, the opportunity pipeline, and POS day-end reports — all from live records.",
    searchIntent: "real-time business reporting software",
    conversion: { heading: "See a number that's true right now, not at month-end.", ctaLabel: CTAS.talkToSpecialist.label },
  },
]);

export function getSolution(slug) {
  return LANDING_SOLUTIONS.find((solution) => solution.slug === slug) || null;
}

export function getSolutionsForModule(moduleKey) {
  return LANDING_SOLUTIONS.filter((solution) => solution.relatedModuleKeys.includes(moduleKey));
}
