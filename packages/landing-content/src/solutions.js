/**
 * Solution pages — Phase 5 IA amendment (see docs/landing-redesign/phase-5/
 * decision-log.md item 1). The approved Phase 1 IA doc explicitly argued
 * against a standalone /solutions tier ("a 'solution' in this product's case
 * is either an industry framing or a workflow framing, not a third thing"),
 * and icp-and-buyer-map.md explicitly folded "replacing spreadsheets" and
 * "consolidating disconnected systems" into the homepage's top-of-funnel
 * framing rather than giving them their own page, for the same reason. The
 * governing prompt for this phase asked for 5 standalone solution pages
 * regardless; the user approved building them as a deliberate amendment.
 *
 * To make that amendment defensible rather than a cannibalisation risk, every
 * solution page here goes materially deeper than the homepage's five-second
 * pitch (packages/landing-content/src/homepage.js's PROBLEM_SECTION) — a real
 * before/after system narrative, concrete translation of what's being
 * replaced, and links to ONE paired platform page (relatedPlatformPageSlug)
 * that a reader can go to for the underlying capability, never restating that
 * page's content. Every approach[] claim traces to
 * docs/landing-redesign/phase-1/product-intelligence.md.
 *
 * screenshotId (optional, Phase 6) is assigned only where a real approved
 * screenshot (apps/landing/lib/product/screenshots.ts) honestly illustrates
 * that page's specific approach[] claims — not a generic module screenshot
 * bolted on for coverage. multi-company-management deliberately has none:
 * no approved screenshot shows company/branch isolation or consolidation,
 * and forcing an unrelated one would misrepresent what the image shows.
 * See docs/landing-redesign/phase-6/decision-log.md.
 */
export const LANDING_SOLUTIONS = Object.freeze([
  {
    slug: "replace-spreadsheets",
    name: "Replace Spreadsheets",
    directDefinition:
      "Replacing spreadsheets with Vercentlabs ERP means one server-validated master-data model, governed numbering series, and an immutable audit trail replacing the item, BOM, and pricing files departments currently maintain separately.",
    problemStatement:
      "Your item master lives in one spreadsheet, your BOM in another, your invoice numbering is a manually incremented cell, and every one of them drifts out of sync with what's actually true the moment two people edit at once.",
    before: "Item codes, prices, and BOM structures re-typed across three or four spreadsheets, with no single version anyone fully trusts — and no record of who changed what, when.",
    after: "One real item and party master feeding every module — Sales pricing, Procurement ordering, Stock valuation, Manufacturing BOMs — with server-validated forms, not a shared file someone else has open.",
    approach: [
      { title: "Item, party, and BOM data becomes one real master", description: "Master data (items, suppliers, customers, addresses, unit-of-measure, bills of material) lives in one server-validated model that every module reads from — not a workbook copied between departments.", moduleKey: "manufacturing" },
      { title: "Manual numbering becomes a governed numbering series", description: "Organisation bootstrap seeds roughly 29 numbering series across the platform at signup — invoice numbers, purchase order numbers, and the rest stop being a manually incremented cell someone eventually gets wrong." },
      { title: "A version-history cell becomes an immutable audit trail", description: "Every record change is logged to an audit table a Postgres trigger makes immutable — UPDATE and DELETE are rejected at the database level, not just hidden by a UI restriction." },
      { title: "Formula-driven totals become server-computed values", description: "Pricing waterfalls, GST tax splits, credit checks, and margin calculations run as real server logic against live data, not a spreadsheet formula that breaks the moment a column gets inserted." },
    ],
    relatedPlatformPageSlug: "/product",
    relatedModuleKeys: ["stock", "sales", "procurement"],
    relatedWorkflowSlugs: ["procure-to-pay"],
    screenshotId: "sales-quotation-detail",
    faqs: [
      { question: "How much of our existing spreadsheet data actually migrates?", answer: "Customers, items, suppliers, and open transactions are migrated and reconciled as part of implementation — see the implementation journey's data-migration phase for the real process, not a manual re-typing exercise." },
      { question: "Will the team lose the flexibility a spreadsheet gives them?", answer: "Server-validated forms replace ad hoc cell edits, which is a real trade-off — you lose free-form editing in exchange for data that every module can trust. Most teams that make this switch are doing so because the free-form editing was already the problem, not a feature." },
      { question: "What if our processes don't match a standard module exactly?", answer: "Implementation's configuration phase adapts numbering, roles, and approval thresholds to your real process rather than forcing a generic template — see the implementation journey for what's actually configurable at that stage." },
    ],
    metaDescription: "See what replaces your item, BOM, and pricing spreadsheets: one server-validated master data model, governed numbering series, and an immutable audit trail — not another file someone else has open.",
    searchIntent: "replace spreadsheets with ERP software",
    conversion: { heading: "See your spreadsheet processes become one governed system.", ctaLabel: "Book a Product Demo" },
  },
  {
    slug: "connect-business-operations",
    name: "Connect Business Operations",
    directDefinition:
      "Connecting business operations with Vercentlabs ERP means CRM, Sales, Procurement, and Accounting reading and writing the same real records at each handoff — not synced copies reconciled between separate tools.",
    problemStatement:
      "Procurement doesn't know what sales just promised a customer. Production doesn't know what procurement just ordered. Every handoff between departments is a re-typed email or a Slack message, not a system that already knows.",
    before: "A CRM opportunity, a Sales quotation, a Procurement purchase order, and an Accounting invoice exist as four separate records in four separate tools, connected only by someone remembering to update all four.",
    after: "One connected data model where a won CRM opportunity is the literal source record for a Sales quotation, an accepted quotation converts to a credit-checked order, and that order generates an invoice through an auditable, idempotent handoff — the same real record, not four copies.",
    approach: [
      { title: "CRM to Sales is a real, cited handoff", description: "A won opportunity is the source record for a quotation (`source_opportunity_id`), and confirming the resulting order writes the win status back to CRM automatically — not a manual status update in two systems.", moduleKey: "crm" },
      { title: "Procurement to Accounting is gated, not assumed", description: "A vendor bill can only be imported once the matching engine confirms the purchase order, receipt, and invoice line up — 2, 3, or 4-way matching, with a mandatory reason for any tolerance override.", moduleKey: "procurement" },
      { title: "Support sees the whole customer, not just the ticket", description: "A support ticket carries first-class references to the customer's CRM account, sales order, invoice, asset, and project records, aggregated into one customer-history view — not four browser tabs.", moduleKey: "support" },
      { title: "One governed approval backbone, not a department-by-department email chain", description: "A single validated, permission-gated command registry wires approvals for discounts, purchase orders, journal entries, and more onto shared decision and separation-of-duties primitives — reused across modules, not reinvented per department." },
    ],
    relatedPlatformPageSlug: "/product/platform",
    relatedModuleKeys: ["crm", "sales", "procurement", "support"],
    relatedWorkflowSlugs: ["lead-to-cash", "procure-to-pay"],
    screenshotId: "sales-order-detail",
    faqs: [
      { question: "Does every module talk to every other module automatically?", answer: "No — the connections are real but specific, not an all-to-all mesh. Standard sales-order fulfillment, for example, does not yet post an automatic stock deduction; only Manufacturing and Point of Sale write to the stock ledger today. See each module page's 'Connected modules' section for the honest, specific relationship." },
      { question: "How is this different from just buying integration middleware for our existing tools?", answer: "Middleware connects separate systems after the fact, with all the sync-lag and conflict-resolution problems that implies. Here, CRM, Sales, Procurement, and Accounting are one system with one data model — there's no sync step for these connections because there's nothing to sync. (Not every module pair works this way yet — see the previous question.)" },
      { question: "What connects the platform underneath these module handoffs?", answer: "See the Platform capability page for the shared control plane — multi-tenancy, roles and permissions, the approval-workflow engine, and the immutable audit trail every module inherits rather than rebuilding." },
    ],
    metaDescription: "See how Vercentlabs connects CRM, Sales, Procurement, and Accounting as one real data model — a won opportunity becomes a quotation, an order, and an invoice without being re-typed at each handoff.",
    searchIntent: "connect business operations software",
    conversion: { heading: "See a lead become an invoice without a single re-typed handoff.", ctaLabel: "Book a Product Demo" },
  },
  {
    slug: "multi-company-management",
    name: "Multi-Company Management",
    directDefinition:
      "Managing multiple companies with Vercentlabs ERP means structural isolation by company and branch, scoped and time-bound roles, and real consolidation when you need a combined view — relevant to a manufacturer running several plants or a distributor running multiple warehouses under one legal umbrella, not just a holding-company structure.",
    problemStatement:
      "You run more than one legal entity, more than one plant, or more than one branch — a manufacturer with several facilities, a distributor with multiple warehouses — and today that means either a separate system per entity or one shared login where anyone can see everyone else's numbers.",
    before: "Either N separate systems (one per company) that never reconcile with each other, or one shared system with no real separation — every user sees every company's data whether they should or not.",
    after: "One platform, structurally isolated by company and branch — a user's access is scoped to the companies, branches, or even departments they're actually granted, with consolidation and intercompany posting available when you need a combined view.",
    approach: [
      { title: "Isolation is structural, not a filtered view", description: "Organisations, companies, branches, departments, and cost centers form a real hierarchy with granular, membership-scoped access — company and branch, not an all-or-nothing switch a careless admin could flip." },
      { title: "Roles can be scoped and time-bound per company or branch", description: "Role assignments can be scoped to specific companies, branches, or departments, and can carry a start and expiry date — a contractor or auditor's access doesn't outlive the engagement." },
      { title: "Consolidation is a real capability, not a manual spreadsheet roll-up", description: "Accounting supports multi-entity consolidation and intercompany posting as part of its close/planning capability group — a combined view exists when you need it, without breaking each entity's own isolated books.", moduleKey: "accounting" },
      { title: "One numbering and role framework, provisioned once", description: "A one-transaction organisation bootstrap seeds roughly 12 roles and 29 numbering series at signup — adding a new company doesn't mean rebuilding your role and numbering structure from scratch." },
    ],
    relatedPlatformPageSlug: "/product/platform",
    relatedModuleKeys: ["accounting"],
    relatedWorkflowSlugs: [],
    faqs: [
      { question: "Can a user work across two companies if their role genuinely requires it?", answer: "Yes — access is scoped per company/branch/department by design, but a role assignment can be granted across multiple scopes where that's the real access someone needs. It's not an all-or-nothing single-tenant switch." },
      { question: "Is consolidation automatic, or does someone have to run it?", answer: "Multi-entity consolidation and intercompany posting are real capabilities inside Accounting's close/planning workflow, not a background job — they run as part of a deliberate close/reporting step, keeping each entity's own books independently accurate." },
      { question: "Does time-bound role access apply to auditors and contractors too?", answer: "Role assignments generally can carry a start and expiry date and can be scoped to a specific company or branch — a reasonable fit for an auditor or contractor engagement, though this is a platform capability, not an auditor-specific feature." },
    ],
    metaDescription: "See how Vercentlabs structurally isolates data by company and branch — scoped, time-bound roles, one shared numbering framework, and real multi-entity consolidation when you need a combined view.",
    searchIntent: "multi-company ERP software",
    conversion: { heading: "See structural isolation across every company you run.", ctaLabel: "Book a Product Demo" },
  },
  {
    slug: "workflow-automation",
    name: "Workflow Automation",
    directDefinition:
      "Automating workflow with Vercentlabs ERP means policy-routed approvals, code-enforced self-approval blocking, and scheduled recurring financial postings — real, built-in governed automations, not a drag-and-drop workflow builder you configure yourself.",
    problemStatement:
      "A discount approval sits in an email thread for a week. A journal entry gets posted without anyone checking it against the account it references. The parts of your process that shouldn't need a human keep needing one anyway.",
    before: "Approvals routed by whoever remembers to forward the email; the same person able to create and approve their own transaction; recurring postings re-entered by hand every period.",
    after: "A shared, governed command registry routes discounts, purchase orders, and journal entries to the right approver by policy, blocks the creator of a transaction from approving their own work, and runs recurring postings — accruals, FX revaluation, dunning — on a schedule instead of a checklist.",
    approach: [
      { title: "Approval routing is policy-driven, not inbox-driven", description: "A single validated, permission-gated command registry wires module approvals onto shared decision primitives — a discount, a purchase order, and a journal entry all route by the same real policy engine, not three different email habits." },
      { title: "Self-approval is blocked in code, not just discouraged in policy", description: "Payroll runs require a different approver than the preparer; leave requests can't be approved by the person who submitted them; an asset's creator can't capitalize or dispose of it themselves — enforced structurally, across HR, Assets, Accounting, and more." },
      { title: "Recurring postings run on a schedule, not a checklist", description: "Accounting automates scheduled recurring journals, accruals, FX revaluation, consolidation, and dunning — the period-end tasks a controller used to have to remember to trigger by hand.", moduleKey: "accounting" },
      { title: "Quality holds trigger automatically, not by someone noticing", description: "A failed quality inspection automatically places an inventory hold on the affected batch, serial, receipt, work order, or return — the hold doesn't wait for a human to catch the failure and act on it.", moduleKey: "quality" },
    ],
    relatedPlatformPageSlug: "/product/automation",
    relatedModuleKeys: ["accounting", "quality", "hr-payroll"],
    relatedWorkflowSlugs: ["procure-to-pay", "hire-to-payroll"],
    screenshotId: "quality-dashboard",
    faqs: [
      { question: "Is this a general-purpose workflow builder we configure ourselves?", answer: "No — this is a set of real, built-in governed automations (approval routing, self-approval blocking, scheduled financial postings, automatic quality holds) rather than a drag-and-drop workflow designer. See the Automation platform page for the full, honest breakdown of what's automatic today versus what still requires a manual trigger." },
      { question: "Does self-approval blocking apply everywhere, or just in Accounting?", answer: "It's a shared pattern applied across multiple modules — Accounting's subledger approvals, Procurement, HR & Payroll's leave and payroll runs, Assets' capitalization and disposal, Projects' timesheet approval — not an Accounting-only control." },
      { question: "What still requires a manual trigger today?", answer: "Manufacturing's material-requirements planning runs and Procurement's requisition creation both still need a person to trigger them — there's no background scheduler running either automatically yet. That's stated plainly, not glossed over." },
    ],
    metaDescription: "See what Vercentlabs automates without a human trigger: policy-routed approvals, code-enforced self-approval blocking, scheduled recurring financial postings, and automatic quality holds.",
    searchIntent: "business process automation software",
    conversion: { heading: "See what stops needing a human to catch it.", ctaLabel: "Book a Product Demo" },
  },
  {
    slug: "real-time-business-reporting",
    name: "Real-Time Business Reporting",
    directDefinition:
      "Real-time reporting with Vercentlabs ERP means every report — project margin, financial statements, pipeline forecast, spend analysis — reads the same live transactional data every module writes to, not a scheduled data-warehouse refresh.",
    problemStatement:
      "Sales, finance, and operations each keep their own version of the numbers, refreshed whenever someone remembers to update the spreadsheet — usually right before the numbers are needed, never when a decision actually depends on them.",
    before: "A month-end close before anyone knows the real margin; a manually rebuilt pipeline forecast; a stock count that's only as current as the last physical walk-through.",
    after: "Project margin computed live from approved actuals while the project is still open. A 16-report Accounting registry, a 14-type CRM reporting suite, and Procurement's 12-report spend/risk analytics — all reading the same live data every other module writes to.",
    approach: [
      { title: "Project margin is live, not a post-mortem", description: "Gross margin is computed from approved labor, approved expenses, and real procurement actuals against contracted revenue while the project is still open — not a report run after the project closes.", moduleKey: "projects" },
      { title: "Financial reporting is a real registry, not a rebuilt spreadsheet", description: "Accounting's 16-report registry covers trial balance, GL, P&L, balance sheet, cash flow, aged AR/AP, tax summary, and close status — plus a hashed close-pack snapshot bundle for audit — all generated from posted transactions, not re-assembled by hand.", moduleKey: "accounting" },
      { title: "Pipeline and forecast numbers come from the same governed pipeline", description: "CRM's 14 report types include weighted and committed forecast by rep and team, computed from the same stage-gated pipeline reps actually work in — not a separate forecast spreadsheet someone reconciles against it.", moduleKey: "crm" },
      { title: "Spend visibility doesn't wait for a quarterly review", description: "Procurement's 12-report registry covers spend analysis, maverick-spend detection, matching exceptions, supplier risk, and cycle time — live operational visibility, not a once-a-quarter audit exercise.", moduleKey: "procurement" },
    ],
    relatedPlatformPageSlug: "/product/analytics",
    relatedModuleKeys: ["accounting", "crm", "procurement", "projects"],
    relatedWorkflowSlugs: ["project-to-profitability"],
    screenshotId: "projects-dashboard",
    faqs: [
      { question: "Is 'real-time' actually real-time, or refreshed on a schedule?", answer: "Reports read live transactional data, not a scheduled data-warehouse refresh — a posted journal, a completed inspection, or an approved timesheet is reflected the next time the relevant report runs, not the next morning." },
      { question: "Can we export data for our own BI tool instead of using the built-in reports?", answer: "CSV export exists with injection-safe handling and hard-capped pagination — see the Analytics platform page for the full breakdown of what's exportable and what stays report-only today." },
      { question: "Do different departments really see the same numbers, or their own version?", answer: "Reports read from the same underlying transactional tables every module writes to — Sales' pipeline reports and Accounting's receivables reports both trace back to the same order and invoice records, not two independently maintained copies." },
    ],
    metaDescription: "See real-time reporting across Vercentlabs: live project margin while a project is still open, a 16-report Accounting registry, CRM forecast reporting, and Procurement spend analytics — all on live data.",
    searchIntent: "real-time business reporting software",
    conversion: { heading: "See a number that's true right now, not at month-end.", ctaLabel: "Book a Product Demo" },
  },
]);

export function getSolution(slug) {
  return LANDING_SOLUTIONS.find((solution) => solution.slug === slug) || null;
}

export function getSolutionsForModule(moduleKey) {
  return LANDING_SOLUTIONS.filter((solution) => solution.relatedModuleKeys.includes(moduleKey));
}
