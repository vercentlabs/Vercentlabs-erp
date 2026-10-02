import { CTAS } from "./navigation.js";

/**
 * Industry pages. These are lower-funnel entry points into the same product;
 * every product statement on them must stay inside the approved launch
 * capability register (capabilities/launch-capabilities.js) — an industry page never gets
 * capabilities the module pages don't have.
 *
 * `icpSlug` is deliberately shared between the "distribution" and "retail"
 * entries — both compose from the same ICP — while each keeps a distinct
 * operating model and module stack.
 */
export const LANDING_INDUSTRIES = Object.freeze([
  {
    slug: "manufacturing",
    icpSlug: "manufacturing",
    name: "Manufacturing",
    directDefinition:
      "Vercentlabs ERP runs production and the back office on one system — a bill of materials becomes a manufacturing order, material issues and finished-goods receipts post to the same stock ledger, and quality and purchasing work from the same records.",
    operatingModel:
      "Growing manufacturers often plan production in spreadsheets, relay shop-floor status by paper or chat, and keep accounting in a separate tool. Vercentlabs replaces that split with one data model: a bill of materials defines what a finished item needs, each manufacturing order checks material availability before work starts, material issue, consumption, and scrap are recorded against the order, production inspections and holds catch problems on the line, and finished goods are received into stock with their production cost.",
    challenges: [
      "No real-time view of raw material and finished-goods stock",
      "Production cost worked out after the fact",
      "Quality problems found at dispatch instead of on the line",
      "Purchasing and production working from different information",
    ],
    moduleStack: [
      { moduleKey: "manufacturing", role: "Turns bills of materials into manufacturing orders, checks material availability, and records issue, consumption, scrap, and finished goods." },
      { moduleKey: "stock", role: "Holds the single stock ledger production posts into — real-time balances, reservations, and valuation per warehouse." },
      { moduleKey: "procurement", role: "Buys raw materials with purchase orders, goods receipts, and invoices matched against both before payment." },
      { moduleKey: "quality", role: "Inspects incoming materials and production output; a quality hold blocks failed stock from moving until it's released." },
      { moduleKey: "accounting", role: "Keeps the general ledger, payables, and financial statements in the same system as production." },
    ],
    primaryWorkflowSlug: "plan-to-production",
    buyerRoleSlugs: ["ceo-owner", "plant-manager", "cfo"],
    evidenceHighlights: [
      "Each manufacturing order checks material availability against its bill of materials before production starts.",
      "Material issues and finished-goods receipts post to the same stock ledger the rest of the business uses.",
      "A quality hold blocks stock movement until the hold is released.",
    ],
    screenshots: { primary: "manufacturing-dashboard" },
    faqs: [
      { question: "What does Vercentlabs Manufacturing cover?", answer: "Bills of materials, manufacturing orders, material availability, material issue and consumption, scrap, production quality inspections and holds, finished-goods receipt, and production costing." },
      { question: "Is there automatic capacity scheduling or MRP?", answer: "No. The launch product runs BOM-based manufacturing orders and their execution; MRP planning runs and capacity scheduling are not part of it." },
      { question: "How fast can we go live, coming off spreadsheets and a separate accounting tool?", answer: "Implementation starts with discovery that maps your real BOMs and production process before any configuration — see the implementation journey for the full methodology, including data migration." },
      { question: "Will the shop floor actually use this, or will it stay a planning-office tool?", answer: "Recording material issues and finished-goods receipts happens on the manufacturing order itself and updates the same stock everyone else sees, so there's no separate system to reconcile against what the floor already did." },
    ],
    metaDescription: "See how Vercentlabs ERP runs manufacturing: BOM-based manufacturing orders, material availability, real-time stock postings, production inspections and holds, and production costing.",
    searchIntent: "manufacturing ERP software",
    conversion: { heading: "See your bill of materials become a stock-linked manufacturing order.", ctaLabel: CTAS.talkToSpecialist.label },
  },
  {
    slug: "distribution",
    icpSlug: "distribution-retail",
    name: "Distribution",
    directDefinition:
      "Vercentlabs ERP gives wholesale distributors one real-time stock balance across every warehouse, with sales orders and purchasing working from the same live inventory — not a weekly export reconciled by hand.",
    operatingModel:
      "Distributors often run several warehouses with a basic sales or billing tool, while stock across locations is reconciled in spreadsheets. Vercentlabs removes the reconciliation step: the stock ledger tracks on-hand, reserved, and available stock per warehouse in real time, internal transfers move stock between warehouses on record, sales orders check availability and reserve stock before they're confirmed, and supplier invoices are matched against purchase orders and goods receipts before they're paid.",
    challenges: [
      "No single view of stock across warehouses",
      "Promising delivery without checking what's available",
      "Manual reconciliation between orders and the books",
      "Purchasing decisions made on stale inventory data",
    ],
    moduleStack: [
      { moduleKey: "stock", role: "Holds one real-time ledger across every warehouse — receipts, transfers, reservations, issues, and valuation." },
      { moduleKey: "sales", role: "Quotes and confirms orders with availability checks and stock reservation, then delivers and invoices them." },
      { moduleKey: "procurement", role: "Buys stock with purchase orders and goods receipts, and matches supplier invoices 2-way or 3-way before payment." },
      { moduleKey: "crm", role: "Keeps the wholesale account relationship — leads, accounts, and opportunities — in the same system as Sales." },
      { moduleKey: "accounting", role: "Posts receivables and payables from real invoices and reconciles receipts and payments with the bank." },
    ],
    primaryWorkflowSlug: "order-to-fulfilment",
    buyerRoleSlugs: ["coo", "ceo-owner", "cfo"],
    evidenceHighlights: [
      "Stock balances update in real time as each receipt, transfer, and issue posts.",
      "Sales orders check availability and reserve stock before they're confirmed.",
      "Supplier invoices are matched against the purchase order, or the order and goods receipt, before payment.",
    ],
    screenshots: { primary: "procurement-orders-list" },
    faqs: [
      { question: "Does this replace our existing POS, or sit alongside it?", answer: "Vercentlabs includes its own Point of Sale module that reduces stock in real time — see the Retail industry page for that angle. For a wholesale operation without a storefront, Stock, Sales, and Procurement are the primary modules; Point of Sale is optional." },
      { question: "How does stock stay accurate across multiple warehouses?", answer: "Every receipt, issue, transfer, and adjustment posts to one stock ledger, physical counts are reconciled with stock adjustments, and negative-stock control stops more being issued than is available." },
      { question: "Can low stock trigger a purchase automatically?", answer: "No. Replenishment is a deliberate purchasing decision in the launch product — made on real-time stock balances rather than a stale export." },
      { question: "Can warehouses sit under different companies or branches?", answer: "Yes. An organisation can run several companies and branches, and access can be scoped to specific companies and branches." },
    ],
    metaDescription: "Vercentlabs ERP gives distributors one real-time stock balance across warehouses, sales orders checked against available stock, and supplier invoices matched before payment.",
    searchIntent: "distribution management system",
    conversion: { heading: "See one real stock number across every warehouse you run.", ctaLabel: CTAS.talkToSpecialist.label },
  },
  {
    slug: "retail",
    icpSlug: "distribution-retail",
    name: "Retail",
    directDefinition:
      "Vercentlabs ERP's Point of Sale reduces stock in real time as each sale completes — so store stock and warehouse stock stay in step, and every shift closes with a Day-End / Z report.",
    operatingModel:
      "Multi-location retailers often run a standalone till with separate accounting and spreadsheets for stock across stores. Vercentlabs closes that gap at the point of sale: cashiers sell from terminals with cash, card, or UPI payments, each sale reduces stock in real time, returns and refunds are recorded at the till, and every shift is opened and closed with a Day-End / Z report and payment reconciliation by payment method.",
    challenges: [
      "Till sales disconnected from back-office stock",
      "No control over who can do what at the register",
      "End-of-day cash reconciliation done by hand",
      "No single view of stock across store locations",
    ],
    moduleStack: [
      { moduleKey: "point-of-sale", role: "Runs checkout, shifts, returns, and refunds — every sale reduces stock in real time." },
      { moduleKey: "stock", role: "Holds the shared, real-time stock ledger every store's sales post into, visible across locations." },
      { moduleKey: "procurement", role: "Buys store stock with purchase orders and goods receipts, with supplier invoices matched before payment." },
      { moduleKey: "crm", role: "Tracks the customer relationship for accounts that buy both over the counter and on account." },
    ],
    primaryWorkflowSlug: "order-to-fulfilment",
    buyerRoleSlugs: ["coo", "ceo-owner"],
    evidenceHighlights: [
      "Each point-of-sale sale reduces stock in real time.",
      "Cash, card, and UPI / digital payments are reconciled by payment method at day end.",
      "Cashiers work under their own permissions.",
    ],
    screenshots: { primary: "point-of-sale-dashboard" },
    faqs: [
      { question: "Which payment methods can the till take?", answer: "Cash, card, and UPI / digital payments, reconciled by payment method in the Day-End / Z report." },
      { question: "Is there a tablet or phone checkout app?", answer: "No. Vercentlabs ERP is a browser-based application with a responsive interface; there is no native POS app at launch." },
      { question: "How is cash accountability handled across shifts?", answer: "Each shift is opened and closed on its terminal, and the Day-End / Z report and payment reconciliation account for what was taken by payment method." },
      { question: "How are returns handled at the till?", answer: "Returns and refunds are recorded at the till like any other transaction, so they're on record rather than handled informally." },
    ],
    metaDescription: "Vercentlabs Point of Sale reduces stock in real time at checkout, takes cash, card, and UPI payments, and closes every shift with a Day-End / Z report and payment reconciliation.",
    searchIntent: "retail ERP with POS",
    conversion: { heading: "See a checkout reduce real inventory in real time.", ctaLabel: CTAS.talkToSpecialist.label },
  },
  {
    slug: "professional-services",
    icpSlug: "professional-services",
    name: "Professional Services",
    directDefinition:
      "Vercentlabs ERP runs project delivery alongside the customers, quotations, and support tickets it relates to — projects, milestones, tasks, timesheets, and progress tracking in the same system as the rest of the business.",
    operatingModel:
      "Project-based businesses often track delivery in a standalone task tool or spreadsheets, with customers, quotes, and support kept somewhere else. Vercentlabs puts them on one system: projects are broken into milestones and tasks with assignees and priorities, team members log timesheets against the work, comments keep discussion attached to the task, progress tracking shows where each project stands, and the same customers flow through CRM, Sales, and Support.",
    challenges: [
      "Project status scattered across spreadsheets and chat",
      "Unclear ownership of tasks",
      "Time recorded inconsistently, or not at all",
      "Customer, quote, and project information in separate tools",
    ],
    moduleStack: [
      { moduleKey: "projects", role: "Tracks projects, milestones, tasks, assignees, priorities, timesheets, comments, and progress." },
      { moduleKey: "crm", role: "Manages the client relationship and the opportunities new work comes from." },
      { moduleKey: "sales", role: "Quotes and invoices the engagement from the same customer records." },
      { moduleKey: "support", role: "Handles client issues as numbered tickets against the same customers and contacts." },
      { moduleKey: "hr-payroll", role: "Holds the employee records for the people assigned to tasks and logging timesheets." },
    ],
    primaryWorkflowSlug: "project-to-profitability",
    buyerRoleSlugs: ["ceo-owner", "cfo", "hr-leader"],
    evidenceHighlights: [
      "Every task has an assignee and a priority.",
      "Timesheets are logged against the project and task the time was spent on.",
      "Project status and progress tracking show where each project stands against its milestones.",
    ],
    screenshots: { primary: "projects-dashboard" },
    faqs: [
      { question: "Does this replace the task tool our team already uses?", answer: "It can — Projects covers projects, milestones, tasks, assignees, priorities, comments, timesheets, and progress tracking. The difference is that it sits in the same system as your customers, quotations, and support tickets." },
      { question: "Does Vercentlabs track project budgets or profitability?", answer: "No. The launch product covers project delivery, timesheets, and progress tracking; project budgets, profitability, and billing are not part of it." },
      { question: "Can consultants log time from their phone?", answer: "Timesheets are entered in the browser, and the interface is responsive on phone screens; there is no native mobile app at launch." },
      { question: "Can clients' issues be tracked alongside projects?", answer: "Yes. Support tickets are logged against the same customers and contacts, so client issues and project work share one customer record." },
    ],
    metaDescription: "Vercentlabs ERP for professional services: projects, milestones, tasks, timesheets, and progress tracking alongside the customers, quotations, and support tickets they relate to.",
    searchIntent: "ERP for professional services",
    conversion: { heading: "See your projects and clients managed in one system.", ctaLabel: CTAS.talkToSpecialist.label },
  },
]);

export function getIndustry(slug) {
  return LANDING_INDUSTRIES.find((industry) => industry.slug === slug) || null;
}

export function getIndustriesForModule(moduleKey) {
  return LANDING_INDUSTRIES.filter((industry) =>
    industry.moduleStack.some((entry) => entry.moduleKey === moduleKey),
  );
}

export function getIndustriesForWorkflow(workflowSlug) {
  return LANDING_INDUSTRIES.filter((industry) => industry.primaryWorkflowSlug === workflowSlug);
}
