/**
 * Industry pages — Phase 5 IA amendment (see docs/landing-redesign/phase-5/
 * decision-log.md item 1). The approved Phase 1 IA defines 3 industry pages
 * (distribution-retail combined); this phase builds 4, splitting distribution
 * and retail into separate pages per the governing prompt's explicit route
 * list. `icpSlug` is deliberately shared between the "distribution" and
 * "retail" entries below — both compose from the same real, researched ICP 2
 * ("Wholesale Distributors & Multi-Location Retailers",
 * docs/landing-redesign/phase-1/icp-and-buyer-map.md) rather than inventing a
 * 4th independently-researched buyer segment. Each still gets a genuinely
 * distinct operatingModel/moduleStack/challenges grounded in the already-real,
 * already-differentiated Procurement and Point of Sale module content.
 *
 * Every operatingModel/challenges/evidenceHighlights line traces to
 * docs/landing-redesign/phase-1/product-intelligence.md and
 * icp-and-buyer-map.md — not independently re-researched.
 */
export const LANDING_INDUSTRIES = Object.freeze([
  {
    slug: "manufacturing",
    icpSlug: "manufacturing",
    name: "Manufacturing",
    directDefinition:
      "Vercentlabs ERP runs the shop floor and the back office on one system — a bill of materials becomes a costed work order, production posts real stock movements, and procurement and quality stay synchronised with what's actually happening on the line.",
    operatingModel:
      "Growing manufacturers typically run 1-5 plants with production planning still tracked in Excel and shop-floor status relayed by paper traveler or WhatsApp, while accounting lives separately in Tally or a similar tool. Vercentlabs replaces that split with one data model: an active bill of materials defines what a finished item requires, a work order snapshots those materials and can't be released without proven component availability, and every material issue or finished-goods receipt posts as a real, auditable stock movement in the same transaction as the production event — not a month-end reconciliation.",
    challenges: [
      "No real-time inventory visibility across raw material, work-in-progress, and finished goods",
      "Production costing is a month-end guess, not a live number",
      "Quality holds and rework aren't tracked systematically",
      "Procurement and production run on different information, causing both stockouts and excess",
    ],
    moduleStack: [
      { moduleKey: "manufacturing", role: "Plans BOMs and work orders, and posts every material issue and finished-goods receipt as a real stock movement." },
      { moduleKey: "stock", role: "Holds the single, race-safe inventory ledger Manufacturing posts into — on-hand, reserved, and valuation, per warehouse." },
      { moduleKey: "procurement", role: "Sources raw materials with a governed requisition-to-order chain, so production isn't waiting on off-the-books purchasing." },
      { moduleKey: "quality", role: "Gates incoming materials and in-process production with inspection points; a failed inspection automatically holds the affected stock." },
      { moduleKey: "accounting", role: "Carries production cost through to real financials, with a governed close instead of a spreadsheet reconciliation." },
    ],
    primaryWorkflowSlug: "plan-to-production",
    buyerRoleSlugs: ["ceo-owner", "plant-manager", "cfo"],
    evidenceHighlights: [
      "A released manufacturing work order cannot proceed without proven component availability.",
      "Every material issue and finished-goods receipt posts a real, auditable stock movement — not a paper work-order tracker sitting beside a separately managed inventory.",
      "Failed quality inspections automatically place an inventory hold on the affected batch, serial, receipt, work order, or return.",
    ],
    screenshots: { primary: "manufacturing-dashboard" },
    faqs: [
      { question: "Does Vercentlabs handle our actual BOM complexity, or just simple assemblies?", answer: "Bills of material are versioned and multi-component, with scrap percentage and a choice of manual or backflush issue method per component. One active BOM per item is enforced, so there's no ambiguity about which structure a work order snapshots from." },
      { question: "Is there automatic capacity scheduling or MRP?", answer: "Material and capacity planning runs produce recommended purchase, manufacture, transfer, or expedite actions — but they're triggered manually today, not run on an automatic scheduler. Treat this as MRP-style planning support, not a fully automated capacity-scheduling engine." },
      { question: "How fast can we actually go live, coming off Tally and Excel?", answer: "Implementation starts with a discovery phase that maps your real BOM and production process before any configuration happens — see the implementation journey for the full 8-phase methodology, including data migration for existing items, suppliers, and open transactions." },
      { question: "Will the shop floor actually use this, or will it stay a planning-office tool?", answer: "Production posting is a single action — issue materials, receive finished goods — that writes the same stock ledger everyone else sees, so there's no separate system to reconcile against what the floor already did." },
    ],
    metaDescription: "See how Vercentlabs ERP runs manufacturing operations: BOM-driven work orders, real-time stock movements, quality holds, and procurement synchronised with production — not a paper tracker beside a separate inventory system.",
    searchIntent: "manufacturing ERP software",
    conversion: { heading: "See your BOM become a costed, stock-linked work order.", ctaLabel: "Book a Product Demo" },
  },
  {
    slug: "distribution",
    icpSlug: "distribution-retail",
    name: "Distribution",
    directDefinition:
      "Vercentlabs ERP gives wholesale distributors one real-time stock number across every warehouse, with procurement decisions driven by the same live inventory data — not a weekly export reconciled by hand.",
    operatingModel:
      "Distributors typically run 3-50 warehouses with a standalone POS or basic accounting tool for sales and billing, while stock across locations is reconciled manually in Excel — the weak point in an otherwise systemised business. Vercentlabs replaces the reconciliation step: Stock's ledger tracks on-hand, reserved, and valuation per warehouse in real time, Procurement's requisition-to-order chain sources replenishment against reorder rules that reference the same live stock data, and every purchase order runs through 2/3/4-way matching before a vendor bill can post — so purchasing decisions aren't made on stale numbers.",
    challenges: [
      "No single view of stock across warehouses",
      "Can't confidently promise delivery dates without checking multiple systems",
      "Manual reconciliation between point-of-sale/order systems and the books",
      "Procurement decisions made on stale inventory data",
    ],
    moduleStack: [
      { moduleKey: "procurement", role: "Runs requisition-to-order sourcing with policy-driven readiness scoring, so replenishment isn't a manual purchasing decision made on old data." },
      { moduleKey: "stock", role: "Holds one real-time ledger — on-hand, reserved, valuation — across every warehouse, with reorder rules feeding a low-stock dashboard." },
      { moduleKey: "sales", role: "Prices and orders with a GST-aware quotation engine and a real-time customer-credit check before confirmation." },
      { moduleKey: "crm", role: "Keeps the wholesale account relationship — leads, opportunities, and account history — in one system with Sales." },
      { moduleKey: "accounting", role: "Reconciles receivables and payables against real orders and matched purchase orders, not a spreadsheet." },
    ],
    primaryWorkflowSlug: "order-to-fulfilment",
    buyerRoleSlugs: ["coo", "ceo-owner", "cfo"],
    evidenceHighlights: [
      "Real 2/3/4-way matching between purchase order, goods receipt, and vendor invoice gates AP bill creation.",
      "GST tax calculation automatically splits CGST/SGST vs. IGST by state on every quotation and order.",
      "Sales orders are checked against real-time aggregated customer credit exposure, under an advisory database lock, before confirmation.",
    ],
    screenshots: { primary: "procurement-orders-list" },
    faqs: [
      { question: "Does this replace our existing POS, or sit alongside it?", answer: "Vercentlabs includes its own Point of Sale module with real-time stock deduction on checkout — see the Retail industry page for that angle. For a pure wholesale/distribution operation without a storefront, Stock and Procurement are the primary modules; POS is optional." },
      { question: "How does stock stay accurate across multiple warehouses without manual counts?", answer: "Every movement — receipt, issue, transfer, adjustment, return, count — posts through a row-locked ledger that enforces available-stock checks, so two people can't oversell the same unit from two terminals." },
      { question: "Can reorder rules trigger a purchase automatically?", answer: "Reorder rules reference a preferred supplier and feed a low-stock dashboard, but there's no automatic requisition job triggered from Stock today — replenishment is still a deliberate purchasing decision, just one made on real-time data instead of a stale export." },
      { question: "Can each warehouse operate under its own branch, or is it all one pool?", answer: "Warehouses are typed and structured under real companies and branches with granular, membership-scoped access — a distributor running several warehouses under one or multiple legal entities gets structural isolation, not just a location filter on one shared pool." },
    ],
    metaDescription: "Vercentlabs ERP gives distributors one real-time stock number across every warehouse, procurement driven by live inventory data, and 2/3/4-way matching that gates AP posting on unresolved variance.",
    searchIntent: "distribution management system",
    conversion: { heading: "See one real stock number across every warehouse you run.", ctaLabel: "Book a Product Demo" },
  },
  {
    slug: "retail",
    icpSlug: "distribution-retail",
    name: "Retail",
    directDefinition:
      "Vercentlabs ERP's Point of Sale posts a real inventory deduction in the same database transaction as the checkout — so store stock, warehouse stock, and the books stay in step without a nightly sync.",
    operatingModel:
      "Multi-location retailers typically run a standalone POS system with Tally or QuickBooks for accounting and Excel for cross-location stock reconciliation — none of it talking to the others until month-end. Vercentlabs replaces the reconciliation gap directly at the point of sale: a checkout completes a multi-line sale with mixed-tender payment and deducts real inventory in the same transaction, one open shift per terminal is enforced so cash accountability is never ambiguous, and shift close computes cash variance automatically instead of a manager reconstructing it from receipts.",
    challenges: [
      "Disconnect between floor sales and back-office stock/cash",
      "Unauthorized over- or under-charging at the register",
      "An indefensible end-of-day cash reconciliation process",
      "No single view of stock across store locations",
    ],
    moduleStack: [
      { moduleKey: "point-of-sale", role: "Runs checkout, shift/cash-drawer control, and returns — every sale deducts real inventory in the same transaction as the checkout." },
      { moduleKey: "stock", role: "Holds the shared, real-time inventory ledger every store checkout posts into — visible across every location, not just the selling store." },
      { moduleKey: "procurement", role: "Sources store replenishment through a governed requisition-to-order chain instead of ad hoc reordering." },
      { moduleKey: "crm", role: "Tracks the customer relationship for accounts that span both counter sales and wholesale/B2B orders." },
      { moduleKey: "accounting", role: "Reconciles the books against real transactions — though POS sales don't yet auto-create a Sales order or Accounting invoice; see the honest limitation below." },
    ],
    primaryWorkflowSlug: "order-to-fulfilment",
    buyerRoleSlugs: ["coo", "ceo-owner"],
    evidenceHighlights: [
      "A point-of-sale checkout deducts live inventory in the same database transaction as the sale — no nightly batch sync.",
      "One open shift per terminal is enforced by a unique index, and shift close computes cash variance automatically.",
      "Returns are line-level and policy-gated for approval, not a free-for-all refund button.",
    ],
    screenshots: { primary: "point-of-sale-dashboard" },
    faqs: [
      { question: "Does a POS sale automatically create a Sales order or an Accounting invoice?", answer: "Not automatically today — the linking columns exist on the POS sale record but aren't populated by an automated process yet. Treat Point of Sale as inventory-integrated in real time, not fully books-integrated, until that link ships." },
      { question: "Is Point of Sale available on a mobile device or tablet?", answer: "No — Point of Sale is explicitly excluded from the mobile module catalog today. It's a desktop/terminal workflow, not a tablet checkout." },
      { question: "How is cash accountability enforced across shifts and terminals?", answer: "A unique index enforces one open shift per terminal, and closing a shift computes the expected-versus-counted cash variance automatically rather than relying on a manager's manual tally." },
      { question: "Can a return be refused or routed for inspection instead of an automatic refund?", answer: "Returns are line-level and policy-gated for approval, not a free-for-all refund button — a return can be routed for review rather than refunded on the spot, matching the same governance discipline as the rest of the platform." },
    ],
    metaDescription: "Vercentlabs Point of Sale deducts real inventory in the same transaction as checkout, enforces one open shift per terminal, and computes cash variance automatically — no nightly stock sync required.",
    searchIntent: "retail ERP with POS",
    conversion: { heading: "See a checkout deduct real inventory in real time.", ctaLabel: "Book a Product Demo" },
  },
  {
    slug: "professional-services",
    icpSlug: "professional-services",
    name: "Professional Services",
    directDefinition:
      "Vercentlabs Projects computes live gross margin from approved labor, expenses, and real procurement actuals against contracted revenue — while the project is still open, not after it closes.",
    operatingModel:
      "Project-based and professional-services businesses typically track delivery in a standalone PM tool or spreadsheets, with financial tie-back to project profitability handled manually and well after the fact. Vercentlabs connects the two directly: a project links to billing method (fixed price, time & material, milestone, or non-billable) and, where relevant, a Sales order; approved timesheets and expenses — with the person who logged them blocked from self-approving — feed a live gross-margin calculation against contracted revenue; and real procurement actuals linked to the project flow into that same margin number, not a separate spreadsheet.",
    challenges: [
      "Don't know which projects are actually profitable until the project is over",
      "Timesheet-to-billing is manual and leaky",
      "Resource utilisation is a guess, not a number",
      "Project procurement isn't tied to project budgets",
    ],
    moduleStack: [
      { moduleKey: "projects", role: "Tracks tasks, timesheets, budgets, and live gross margin — computed from approved actuals, not a static report." },
      { moduleKey: "crm", role: "Manages the client relationship and opportunity that a project can originate from." },
      { moduleKey: "sales", role: "Quotes and orders the engagement, with the resulting order linkable to the project." },
      { moduleKey: "accounting", role: "Receives idempotent billing-milestone handoffs and posts the resulting invoice — no duplicate billing risk on retry." },
      { moduleKey: "hr-payroll", role: "Supplies the workforce data timesheets and cost rates draw from, under the same self-approval-blocked governance." },
    ],
    primaryWorkflowSlug: "project-to-profitability",
    buyerRoleSlugs: ["ceo-owner", "cfo", "hr-leader"],
    evidenceHighlights: [
      "Project profitability is computed live from approved labor, approved expenses, and real procurement actuals against contracted revenue while the project is still open.",
      "The person who logs a timesheet entry cannot approve their own entry — self-approval is blocked, not just discouraged.",
      "Billing milestones use idempotency keys, so the same billing event can't be entered — or double-billed — twice.",
    ],
    screenshots: { primary: "projects-dashboard" },
    faqs: [
      { question: "Does this replace the PM tool our team already uses and likes?", answer: "Vercentlabs Projects is positioned as the finance and operations layer underneath project delivery — task and timesheet tracking, budget versioning, and live margin — not a general-purpose project-management replacement. If your team's PM tool handles day-to-day task collaboration well, the value here is connecting that work to real financials." },
      { question: "Can it handle mixed billing models — fixed price, T&M, and milestone — across different clients?", answer: "Yes — billing method is set per project (fixed price, time and material, milestone, or non-billable), so a services firm running different commercial models across its client base doesn't need a workaround." },
      { question: "Is there a mobile app for logging time in the field?", answer: "Not today — Projects has no native mobile presence, which is a real gap for field-based time entry. Time tracking is a browser workflow, not a phone app." },
      { question: "Who can approve a consultant's logged hours?", answer: "Not the consultant who logged them — self-approval is blocked structurally, so the cost data feeding the live margin calculation is never self-certified by the person who created it." },
    ],
    metaDescription: "Vercentlabs Projects computes live gross margin from approved labor, expenses, and procurement actuals against contracted revenue — see project profitability before the project ends, not after.",
    searchIntent: "ERP for professional services",
    conversion: { heading: "See project profitability before the project ends.", ctaLabel: "Book a Product Demo" },
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
