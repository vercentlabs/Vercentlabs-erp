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
 *
 * Every field below (directDefinition, businessProblems, capabilityGroups,
 * primaryWorkflow, connectedModules, reporting, automation, governance) is
 * sourced directly from docs/landing-redesign/phase-1/product-intelligence.md's
 * per-module profile — not independently re-researched. requirementCount values
 * are a structural allocation of the settled 945 module-specific requirements
 * (CLAUDE.md), not an independent re-count — see
 * docs/landing-redesign/phase-4/capability-traceability.md for the methodology.
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
    bestAngle:
      "A public capture form becomes a scored, SLA-tracked lead, converts to an account and opportunity in one step, and syncs offline on mobile with conflict-safe queuing.",
    accentColor: { hex: "#6956d9", soft: "#f2efff", sourcedFromProduct: true },
    directDefinition:
      "The Vercentlabs CRM module is the revenue team's system of record — it captures leads from any channel, qualifies and routes them by policy, and manages the account, contact, and opportunity lifecycle through to a won deal, with privacy governance and offline mobile access built in rather than bolted on.",
    heroVariant: "screenshot-led",
    searchIntent: "CRM ERP",
    metaDescription:
      "Vercentlabs CRM captures, scores, and routes leads, manages accounts and opportunities through a governed pipeline, and syncs natively offline on mobile. See how it connects to Sales and Accounting.",
    businessProblems: [
      { title: "Leads go stale with no SLA discipline", description: "A lead sits in an inbox or spreadsheet with no clock running on it, and by the time someone follows up, the buyer has moved on." },
      { title: "Fragmented intake across channels", description: "Leads arrive from a website form, a phone call, and a trade show list, each captured differently and re-entered by hand — some never make it into the system at all." },
      { title: "No unified customer 360", description: "A rep can see the last email but not the last invoice or the last support ticket, so every conversation starts from a partial picture." },
      { title: "Undisciplined pipeline stage-skipping", description: "Deals get marked 'qualified' without the qualification actually happening, so the forecast reflects optimism, not evidence." },
    ],
    businessOutcomes: [
      { title: "Faster, SLA-timed follow-up", description: "Every captured lead is scored and assigned by policy, not by whoever happens to check the inbox first." },
      { title: "A pipeline that reflects real qualification", description: "Playbook-gated stage exit means a deal can't move to the next stage until its qualification questions are actually answered." },
      { title: "One account view, not three", description: "Account, contact, and opportunity history live in one record, visible to sales, marketing, and support alike." },
      { title: "Field teams stay current without a desk", description: "Leads, opportunities, activities, and pipeline are native and offline on mobile, with conflict-safe sync when connectivity returns." },
    ],
    capabilityGroups: [
      {
        id: "crm-core-engine",
        name: "Core lead-to-opportunity engine",
        description: "The governed spine of the module: leads convert to accounts, contacts, and opportunities in one step, and pipeline stages can't be skipped without qualification.",
        capabilities: [
          "Idempotent lead-to-customer conversion creating an account, contact, and opportunity together",
          "Playbook-gated pipeline stage exit — a deal can't advance until qualification questions are answered",
          "Duplicate-account detection instead of silent duplicate creation",
        ],
        requirementCount: 24,
        workflowSlug: "lead-to-cash",
      },
      {
        id: "crm-lead-acquisition",
        name: "Lead acquisition & intelligence",
        description: "How leads get in, get scored, and get worked before a human ever touches them.",
        capabilities: [
          "CSV import with a preview, commit, and rollback step",
          "Signed public capture forms and inbound webhooks",
          "Automatic lead scoring and business-hours SLA tracking",
          "Nurture ranking and policy-driven assignment",
        ],
        requirementCount: 20,
      },
      {
        id: "crm-communications",
        name: "Communications & conversation intelligence",
        description: "Every touchpoint with a prospect stays attached to their record instead of living in someone's personal inbox.",
        capabilities: [
          "OAuth-connected email and calendar sync",
          "Meeting booking tied to the opportunity",
          "Signed telephony webhooks with click-to-call and call transcription",
        ],
        requirementCount: 18,
      },
      {
        id: "crm-marketing-execution",
        name: "Marketing execution",
        description: "Segment and nurture without exporting the list to a separate marketing tool.",
        capabilities: [
          "SQL-compiled audience segments",
          "Branching, multi-step nurture journeys",
          "A/B variant testing with frequency caps",
          "In-product surveys",
        ],
        requirementCount: 16,
      },
      {
        id: "crm-customer-success",
        name: "Customer success & account intelligence",
        description: "What happens after the deal closes — retention, health, and the compliance work that comes with holding customer data.",
        capabilities: [
          "Account health scoring and churn-risk workflow",
          "A unified Customer 360 view",
          "GDPR-style data-subject request handling with a preview-before-execute step",
        ],
        requirementCount: 18,
      },
      {
        id: "crm-partner-ai",
        name: "Partner engagement & AI",
        description: "Channel-partner workflows and AI assistance, both built with the same governance discipline as the rest of the module.",
        capabilities: [
          "Deal registration with conflict detection",
          "Market development fund (MDF) tracking",
          "Next-best-action suggestions and PII-redacted AI-drafted replies",
        ],
        requirementCount: 14,
      },
    ],
    primaryWorkflow: {
      name: "Lead to Qualified Opportunity",
      trigger: "A lead is captured from a public form, an import, or a signed webhook.",
      steps: [
        { step: "Capture", detail: "The lead lands in the system with source and campaign attribution intact." },
        { step: "Score and assign", detail: "Automatic scoring and an assignment policy route the lead to the right rep — no manual triage queue." },
        { step: "SLA-timed follow-up", detail: "A business-hours SLA clock starts; stale leads surface before they go cold." },
        { step: "Qualification", detail: "Playbook questions must be answered before the pipeline stage can advance." },
        { step: "Conversion", detail: "One action creates the account, contact, and opportunity together — duplicates are flagged, not silently created." },
      ],
      approvals: ["Stage-exit is gated by playbook completion, not open-ended manager approval."],
      automatedActions: ["Lead scoring", "SLA due-date calculation", "Assignment routing", "Duplicate-account flagging"],
      connectedModuleKeys: ["sales"],
      outcome: "A qualified, deduplicated opportunity ready to be quoted in Sales — with the full lead and communication history still attached.",
    },
    connectedModules: [
      { moduleKey: "sales", relationship: "A won opportunity becomes the source for a Sales quotation, and an order confirmation writes the opportunity status back to CRM." },
      { moduleKey: "support", relationship: "Support tickets carry the same account and contact IDs, so the customer's commercial history is visible from a ticket." },
    ],
    reporting: [
      { name: "Pipeline and conversion", measures: "Stage-by-stage conversion rate and pipeline value", audience: "Sales managers, RevOps" },
      { name: "Forecast", measures: "Weighted and committed forecast by rep and team", audience: "Sales leadership" },
      { name: "Revenue operations", measures: "Lead source performance and SLA adherence", audience: "RevOps, marketing ops" },
      { name: "Account health", measures: "Churn-risk scoring across the active account base", audience: "Customer success" },
      { name: "AI governance", measures: "Usage and redaction audit for AI-assisted drafting", audience: "Compliance/privacy officers" },
    ],
    automation: [
      { title: "Event-driven rule engine", description: "Rules fire on record events with per-rule isolation, so one failing rule can't roll back another." },
      { title: "Assignment and scoring", description: "Leads are scored and routed automatically at capture, not queued for manual triage." },
      { title: "Stage-gated pipeline", description: "Playbook-gated stage exit enforces qualification discipline without a manager having to check every deal." },
    ],
    governance: [
      { title: "Route and service-layer permission checks", description: "Access is checked at both the API route and the service layer, not just the UI." },
      { title: "Optimistic-concurrency stage guards", description: "Two people can't silently overwrite each other's pipeline stage change." },
      { title: "AI PII redaction", description: "AI-assisted drafting redacts personal data before it reaches the model." },
    ],
    implementationConsiderations: [
      "Lead sources, campaigns, and assignment rules need to be defined before go-live.",
      "Existing leads and accounts are migrated and deduplicated against the conversion logic, not re-typed by hand.",
      "Email/calendar OAuth connections and telephony webhooks are configured per organization.",
      "Playbook qualification questions are configured to match your actual sales process.",
    ],
    faqs: [
      { question: "Can CRM leads convert into Sales quotations directly?", answer: "Yes — a won CRM opportunity is the source record for a Sales quotation, and confirming the resulting order writes the win back to the opportunity automatically." },
      { question: "Does the CRM module work offline on mobile?", answer: "Leads, opportunities, activities, and pipeline are native and offline-capable on mobile, with conflict-safe sync when the device reconnects. Deeper sub-modules (marketing execution, AI tooling) are secure-browser-handoff." },
      { question: "How is customer data-privacy handled?", answer: "GDPR-style data-subject requests go through a preview-before-execute step, so a deletion or export request can be reviewed before it runs." },
    ],
    screenshots: { primary: "crm-pipeline-board", secondary: "crm-leads-list" },
    conversion: { heading: "See how Vercentlabs CRM would manage your lead-to-opportunity process.", ctaLabel: "Book a Product Demo" },
  },

  sales: {
    navGroup: "revenue",
    personas: ["Sales reps and managers", "Sales ops / finance approvers", "Billing/finance teams"],
    painPoints: [
      "Manual, error-prone GST-aware pricing",
      "Untracked quotation revisions",
      "Orders that exceed customer credit",
    ],
    bestAngle:
      "A GST-aware quotation is accepted publicly with a typed signature, converts to an order with a real-time credit check, and hands off to Accounting through an idempotent, auditable request.",
    accentColor: { hex: "#2468d7", soft: "#edf4ff", sourcedFromProduct: true },
    directDefinition:
      "The Vercentlabs Sales module is the quote-to-cash engine — it turns a priced, tax-compliant, versioned quotation into a credit-checked order with an auditable handoff to Accounting, including a public link the customer can accept without logging in.",
    heroVariant: "workflow-led",
    searchIntent: "Sales management ERP",
    metaDescription:
      "Vercentlabs Sales prices GST-aware quotations, accepts them publicly with a typed signature, and converts to a credit-checked order with an auditable Accounting handoff.",
    businessProblems: [
      { title: "Manual, error-prone tax-aware pricing", description: "Pricing a quotation with the right discount and the right GST split by hand invites mistakes that surface at invoicing, not before." },
      { title: "Untracked quotation revisions", description: "A customer negotiates a quote over email and nobody can say which version they actually agreed to." },
      { title: "Orders that exceed customer credit", description: "An order gets confirmed and shipped before anyone checks whether the customer is already over their credit limit." },
      { title: "No clean order-to-fulfillment link", description: "Sales, warehouse, and finance each keep their own record of what was actually ordered, and the three drift apart." },
    ],
    businessOutcomes: [
      { title: "Consistent, compliant pricing", description: "A price-list-to-rule-to-override waterfall applies discounts and GST splits the same way every time." },
      { title: "A defensible record of what was agreed", description: "Quotation versions are diffed and tracked, and public acceptance is captured with a typed signature." },
      { title: "No surprise credit exposure", description: "Order confirmation is checked against the customer's real-time credit exposure before it's allowed to proceed." },
      { title: "One auditable handoff to finance", description: "The order-to-invoice request is idempotency-keyed, so it can't create a duplicate invoice on retry." },
    ],
    capabilityGroups: [
      {
        id: "sales-pricing-tax",
        name: "Quotation pricing & tax engine",
        description: "How a quotation gets its price and tax figures — automatically, not by memory.",
        capabilities: [
          "Price-list-to-pricing-rule-to-override waterfall",
          "Automatic CGST/SGST vs. IGST split by state",
          "Margin redaction for roles that shouldn't see cost",
        ],
        requirementCount: 18,
      },
      {
        id: "sales-quotation-governance",
        name: "Quotation governance & approvals",
        description: "Discounts and terms that cross a threshold don't just go out the door.",
        capabilities: [
          "Threshold-based auto-approval vs. approval-request routing",
          "Version diffing across quotation revisions",
        ],
        requirementCount: 14,
      },
      {
        id: "sales-order-lifecycle",
        name: "Order lifecycle & credit control",
        description: "From an accepted quote to a confirmed, shippable order.",
        capabilities: [
          "Idempotent quote-to-order promotion",
          "Advisory-locked customer credit-exposure check at confirmation",
          "Holds, controlled amendment, and return requests",
        ],
        requirementCount: 20,
      },
      {
        id: "sales-fulfillment-handoff",
        name: "Fulfillment / invoice handoff",
        description: "The auditable bridge from a confirmed order to a posted Accounting invoice.",
        capabilities: ["Idempotency-keyed invoice-request objects that can't double-post on retry"],
        requirementCount: 15,
      },
      {
        id: "sales-public-acceptance",
        name: "Public quote acceptance",
        description: "A customer can accept or reject a quotation without a login.",
        capabilities: [
          "SHA-256-hashed, single-use share tokens",
          "View tracking on the public link",
          "Typed-signature accept/reject",
        ],
        requirementCount: 18,
      },
    ],
    primaryWorkflow: {
      name: "Quote to Confirmed Order",
      trigger: "A quotation is created from a won CRM opportunity or directly by a sales rep.",
      steps: [
        { step: "Price", detail: "The price-list/rule/override waterfall and GST split are applied automatically." },
        { step: "Approve", detail: "Discounts above a configured threshold route to approval instead of auto-clearing." },
        { step: "Send for public acceptance", detail: "A hashed, single-use link lets the customer view and accept without an account." },
        { step: "Customer accepts", detail: "Acceptance is captured with a typed digital signature." },
        { step: "Convert to order", detail: "Conversion is idempotent — retrying it can't create a duplicate order." },
        { step: "Credit check at confirmation", detail: "The order is checked against real-time aggregated customer credit exposure under an advisory lock before it's confirmed." },
      ],
      approvals: ["Discounts above a configured threshold require approval before the quotation can be sent."],
      automatedActions: ["Tax calculation", "Threshold-based approval routing", "Credit-exposure check", "Auto-cancel of pending approvals on quote revision"],
      connectedModuleKeys: ["crm", "accounting", "stock"],
      outcome: "A confirmed order within the customer's credit limit, ready for fulfillment, with an idempotent invoice request queued for Accounting.",
    },
    connectedModules: [
      { moduleKey: "crm", relationship: "Quotations are sourced from won CRM opportunities, and order confirmation writes the win back to CRM." },
      { moduleKey: "accounting", relationship: "A confirmed order generates an invoice request through an idempotency-keyed, auditable handoff." },
      { moduleKey: "stock", relationship: "Order lines carry a warehouse reference for the fulfillment team, though standard order fulfillment does not yet post an automatic stock deduction — see the Stock module page." },
    ],
    reporting: [
      { name: "Quotation conversion", measures: "Quote-to-order conversion rate by rep and product line", audience: "Sales managers" },
      { name: "Order intake", measures: "New order volume and value over time", audience: "Sales leadership, finance" },
      { name: "Expiring quotations", measures: "Quotes approaching their validity deadline", audience: "Sales reps" },
      { name: "Pending approvals", measures: "Discounts and terms waiting on sign-off", audience: "Sales ops, finance approvers" },
      { name: "Billing readiness and margin", measures: "Orders ready to invoice and their margin", audience: "Finance, sales leadership" },
    ],
    automation: [
      { title: "Threshold-driven approval branching", description: "Only discounts and terms that cross a configured threshold need a human sign-off." },
      { title: "Auto-cancel on revision", description: "Revising a quotation automatically cancels any pending approval on the prior version, so approvers never sign off on stale terms." },
      { title: "Document event trail", description: "Every action on a quotation or order writes a row to the sales document event log." },
    ],
    governance: [
      { title: "15+ granular sales permissions", description: "Enforced at the service layer, not just hidden in the UI." },
      { title: "Uniform margin redaction", description: "Cost and margin figures are hidden from roles that shouldn't see them, consistently across every view." },
      { title: "Immutable event trail", description: "Every state change on a quotation or order is logged and cannot be edited after the fact." },
    ],
    implementationConsiderations: [
      "Price lists, pricing rules, and approval thresholds are configured to match your actual commercial policy.",
      "GST registration details and state-wise tax rules are set up per company/branch.",
      "Customer credit limits are migrated in before go-live so the credit check has real data to check against.",
      "Existing open quotations and orders are migrated and reconciled, not re-entered.",
    ],
    faqs: [
      { question: "Can a customer accept a quotation without creating an account?", answer: "Yes — quotations are sent as a hashed, single-use public link, and the customer accepts or rejects with a typed digital signature, no login required." },
      { question: "What stops an order from shipping to a customer over their credit limit?", answer: "Order confirmation runs a real-time, advisory-locked check against the customer's aggregated credit exposure before the order can be confirmed." },
      { question: "Does confirming a Sales order automatically deduct stock?", answer: "Not today — order lines carry a warehouse reference, but standard Sales-order fulfillment does not yet post an automatic stock movement. Manufacturing and Point of Sale do post real stock movements; see the Stock module page for the honest current state." },
    ],
    screenshots: { primary: "sales-quotation-detail", secondary: "sales-order-detail" },
    conversion: { heading: "See how Vercentlabs Sales would manage your quote-to-order process.", ctaLabel: "Book a Product Demo" },
  },

  accounting: {
    navGroup: "finance",
    personas: ["Controllers/CFOs", "Accountants/bookkeepers", "AP/AR clerks", "Tax/compliance officers", "Auditors"],
    painPoints: [
      "Spreadsheet-driven month-end close",
      "Duplicate or erroneous payments",
      "Bolt-on GST compliance",
    ],
    bestAngle:
      "Two- and three-way matching gates every accounts-payable posting, and period close is a governed, task-gated workflow that mechanically blocks completion until every exception is resolved.",
    accentColor: { hex: "#31566f", soft: "#edf4f7", sourcedFromProduct: true },
    directDefinition:
      "The Vercentlabs Accounting module is a multi-company, multi-currency general ledger and financial-operations system — receivables, payables, banking, fixed assets, tax, and a governed period close, with native India GST compliance built into the ledger, not added on afterward.",
    heroVariant: "operational-sequence",
    searchIntent: "Accounting ERP",
    metaDescription:
      "Vercentlabs Accounting runs GL, receivables, payables with real PO/receipt/invoice matching, banking reconciliation, fixed assets, GST compliance, and a governed period close.",
    businessProblems: [
      { title: "Spreadsheet-driven month-end close", description: "Close depends on someone remembering every subledger, bank account, and tax exception to check — and a missed one shows up in the next audit." },
      { title: "Duplicate or erroneous payments", description: "A vendor bill gets paid twice, or paid before it's actually matched against what was ordered and received." },
      { title: "Bolt-on GST compliance", description: "Tax calculation and e-invoicing live in a separate tool that has to be reconciled against the books by hand." },
      { title: "Unauthorized postings", description: "A journal entry gets posted without anyone else reviewing it, and there's no clean record of who approved what." },
    ],
    businessOutcomes: [
      { title: "A close that can't skip a step", description: "A 7-task governed close checklist blocks completion until every subledger, bank, and tax exception is actually resolved." },
      { title: "AP that can't be double-paid or overbilled", description: "Two- and three-way matching, with per-line variance tolerance, gates every bill before it can be created." },
      { title: "GST compliance built into the ledger", description: "CGST/SGST/IGST/TDS/TCS calculation and e-invoice/e-way-bill requests happen inside the same system that posts the transaction." },
      { title: "A defensible audit trail", description: "Every posting is logged to an immutable event stream, and self-approval is blocked on subledger postings." },
    ],
    capabilityGroups: [
      {
        id: "accounting-gl",
        name: "General ledger & journals",
        description: "The ledger core — draft, approve, and post, with the year-end close computed automatically.",
        capabilities: ["Draft-to-approve-to-post journal lifecycle", "Auto-computed year-end closing journal"],
        requirementCount: 16,
      },
      {
        id: "accounting-receivables",
        name: "Receivables",
        description: "Customer invoices, generated from Sales, and the aging/collections work that follows.",
        capabilities: ["Invoices auto-generated from confirmed Sales orders", "Aging and collections/dunning tracking"],
        requirementCount: 18,
      },
      {
        id: "accounting-payables",
        name: "Payables & PO/receipt/invoice matching",
        description: "Vendor bills that can only be created once they're actually matched.",
        capabilities: [
          "Vendor bills importable from matched Procurement records",
          "2/3-way matching with per-line tolerance and a mandatory-reason override",
          "Duplicate-invoice-number blocking",
        ],
        requirementCount: 22,
      },
      {
        id: "accounting-banking",
        name: "Banking & reconciliation",
        description: "Bringing the bank statement and the ledger into agreement.",
        capabilities: ["CSV bank-statement import with a SHA-256 integrity hash"],
        requirementCount: 12,
      },
      {
        id: "accounting-fixed-assets",
        name: "Fixed asset subledger",
        description: "A GL-mapped depreciation subledger — a separate data model from the EAM Assets module (see Honest Limitations).",
        capabilities: ["GL-account-mapped asset categories", "Straight-line, declining-balance, and units-of-production depreciation"],
        requirementCount: 14,
      },
      {
        id: "accounting-tax-compliance",
        name: "Tax & compliance (GST/TDS/TCS)",
        description: "India-specific tax compliance as part of the ledger, not a bolt-on.",
        capabilities: ["CGST/SGST/IGST/TDS/TCS ledger with HSN/SAC and reverse-charge handling", "Idempotent GST e-invoice and e-way-bill compliance requests"],
        requirementCount: 20,
      },
      {
        id: "accounting-close-planning",
        name: "Close, planning & consolidation",
        description: "The governed monthly close, plus multi-entity planning.",
        capabilities: [
          "7-task governed close checklist with blocking dependencies",
          "Multi-entity consolidation and intercompany posting",
          "Cash-forecast scenarios and a budget lifecycle",
        ],
        requirementCount: 18,
      },
    ],
    primaryWorkflow: {
      name: "Bill Matching to Financial Close",
      trigger: "A vendor bill is imported from a matched Procurement receipt, or a Sales order generates an invoice request.",
      steps: [
        { step: "Match", detail: "2- or 3-way matching checks the bill against the purchase order and receipt, with a mandatory reason required for any override." },
        { step: "Post", detail: "A matched bill (or invoice request) posts to the ledger through the draft-approve-post lifecycle." },
        { step: "Reconcile", detail: "Bank statements are imported and reconciled against posted transactions." },
        { step: "Close checklist", detail: "A 7-task governed checklist walks subledgers, bank, tax, and accruals — completion is blocked until every exception is resolved." },
        { step: "Report", detail: "Trial balance, P&L, balance sheet, and cash-flow reports are generated from the closed period." },
      ],
      approvals: ["Journal entries follow a draft-approve-post lifecycle.", "Subledger postings block self-approval by the preparer."],
      automatedActions: ["Recurring journals, accruals, and FX revaluation", "Consolidation and dunning", "GST e-invoice/e-way-bill requests"],
      connectedModuleKeys: ["sales", "procurement"],
      outcome: "A closed period with every subledger, bank, and tax exception resolved, and a hashed close-pack snapshot for audit.",
    },
    connectedModules: [
      { moduleKey: "sales", relationship: "Confirmed Sales orders generate receivables invoices through an idempotent, auditable request — a confirmed cross-module link." },
      { moduleKey: "procurement", relationship: "Matched Procurement receipts gate vendor-bill creation in Payables — a confirmed cross-module link." },
      { moduleKey: "assets", relationship: "The Accounting fixed-asset subledger and the Assets (EAM) module are independent data models with no shared table — see Honest Limitations before assuming a unified asset pipeline." },
    ],
    reporting: [
      { name: "Trial balance & GL", measures: "Full general-ledger detail by account and period", audience: "Accountants, auditors" },
      { name: "P&L and balance sheet", measures: "Standard financial statements", audience: "Controllers/CFOs" },
      { name: "Cash flow", measures: "Cash movement and forecast scenarios", audience: "Treasury, CFOs" },
      { name: "Aged AR/AP", measures: "Outstanding receivables and payables by age band", audience: "AP/AR clerks, collections" },
      { name: "Close status & subledger reconciliation", measures: "Live progress against the 7-task close checklist", audience: "Controllers" },
      { name: "Tax summary", measures: "GST/TDS/TCS position for the period", audience: "Tax/compliance officers" },
    ],
    automation: [
      { title: "Subledger approval engine", description: "Self-approval is blocked, and every posting is content-hash tamper-checked." },
      { title: "Scheduled recurring entries", description: "Recurring journals, accruals, and FX revaluation post on schedule without manual re-entry." },
      { title: "Idempotent tax compliance requests", description: "GST e-invoice and e-way-bill requests are idempotent, so a retry can't create a duplicate filing." },
    ],
    governance: [
      { title: "26-entry permission set", description: "Including a dedicated audit-only view, so an auditor can see everything without being able to change anything." },
      { title: "Company-scoped queries", description: "Nearly every query is scoped to the company, enforced structurally, not just filtered in the UI." },
      { title: "Maker-checker and period locks", description: "Approval is required before posting, and a closed period can be locked against further changes." },
    ],
    implementationConsiderations: [
      "Chart of accounts, tax codes, and GST registration details are configured per company before go-live.",
      "Opening balances and open AR/AP are migrated and reconciled, not re-entered from scratch.",
      "Matching tolerances and the close checklist are configured to match your actual close process.",
      "Depreciation methods and asset categories are set up if the fixed-asset subledger is in scope.",
    ],
    faqs: [
      { question: "Does Accounting handle India GST compliance natively?", answer: "Yes — CGST/SGST/IGST/TDS/TCS calculation, HSN/SAC coding, and idempotent e-invoice/e-way-bill requests are part of the ledger, not a separate tool." },
      { question: "Is the fixed-asset subledger the same as the Assets (EAM) module?", answer: "No — they are independent data models with no shared table or foreign key, despite a UI-labeled 'accounting handoff' permission. Don't assume a single unified asset-to-depreciation pipeline; see the Assets module page for what EAM actually tracks." },
      { question: "Can the close be completed with unresolved exceptions?", answer: "No — the 7-task governed close checklist has blocking dependencies, so completion is mechanically blocked until every subledger, bank, and tax exception is resolved." },
    ],
    // Accounting has no dedicated screenshot evidence today — {} is the honest
    // state (Phase 4 Cycle 2 review caught an earlier version of this file
    // borrowing "sales-order-detail" here, which rendered a real Sales screen
    // under an "Accounting screens" caption — a genuine evidence-honesty bug,
    // not a stylistic one. See docs/landing-redesign/phase-4/decision-log.md).
    // Phase 5 closed the gap with a dedicated Accounting dashboard capture.
    screenshots: { primary: "accounting-dashboard" },
    conversion: { heading: "See how Vercentlabs Accounting would run your bill-matching and close process.", ctaLabel: "Book a Product Demo" },
  },

  procurement: {
    navGroup: "operations",
    personas: ["Procurement/purchasing managers", "Sourcing buyers", "Receiving clerks", "AP/finance staff"],
    painPoints: [
      "Maverick / off-contract spend",
      "Supplier risk blind spots",
      "Invoice-to-PO overbilling",
    ],
    bestAngle:
      "An invoice-matching engine mechanically blocks accounts-payable bill creation on unresolved variance, with live readiness scoring across the entire requisition-to-payment chain.",
    accentColor: { hex: "#087f6a", soft: "#eaf8f4", sourcedFromProduct: true },
    directDefinition:
      "The Vercentlabs Procurement module is a source-to-pay control tower — it governs requisition, sourcing, ordering, receiving, and invoice matching with policy-driven readiness scoring at every stage, so a bill can't reach Accounts Payable until it's actually matched.",
    heroVariant: "workflow-led",
    searchIntent: "Procurement ERP software",
    metaDescription:
      "Vercentlabs Procurement governs requisition-to-payment with sourcing, RFQs, 2/3/4-way receipt matching, and a governance control tower that blocks unmatched bills from reaching AP.",
    businessProblems: [
      { title: "Maverick, off-contract spend", description: "Purchases happen outside any approved supplier or requisition process, and nobody notices until the invoice arrives." },
      { title: "Supplier risk blind spots", description: "There's no structured view of which suppliers are qualified, certified, or performing — decisions rely on memory." },
      { title: "Invoice-to-PO overbilling", description: "A vendor invoice gets paid at a different price or quantity than what was actually ordered and received." },
      { title: "Approval bottlenecks with no audit trail", description: "Requisitions and orders wait on approval with no clear record of who signed off, or why an exception was allowed." },
    ],
    businessOutcomes: [
      { title: "Spend that stays inside policy", description: "A draft-submit-approve-execute state machine governs every requisition and order, with PO amendment handled as a real workflow, not an email." },
      { title: "Structured supplier oversight", description: "Supplier sites, qualifications, certifications, and scorecards give buyers a real basis for sourcing decisions." },
      { title: "Bills that can't overbill", description: "2/3/4-way matching with per-line variance tolerance blocks a bill from reaching AP until it actually reconciles." },
      { title: "A live view of where spend stands", description: "Policy-configurable readiness rules and an exception-case queue show exactly what's blocking the next step." },
    ],
    capabilityGroups: [
      {
        id: "procurement-requisition-order",
        name: "Requisition-to-order lifecycle",
        description: "The governed path from a request to an issued purchase order.",
        capabilities: ["Draft-submit-approve-execute state machine", "PO amendment as a tracked workflow"],
        requirementCount: 18,
      },
      {
        id: "procurement-sourcing",
        name: "Sourcing & supplier management",
        description: "Choosing and qualifying who you buy from.",
        capabilities: ["Supplier sites, qualifications, and certifications", "Supplier scorecards", "RFQ invitations, bids, evaluations, and awards"],
        requirementCount: 22,
      },
      {
        id: "procurement-receiving-matching",
        name: "Receiving & matching",
        description: "What arrives gets checked against what was ordered before a bill can move forward.",
        capabilities: ["2/3/4-way match with per-line variance tolerance", "Mandatory-reason override on matching exceptions"],
        requirementCount: 20,
      },
      {
        id: "procurement-governance",
        name: "Governance / control tower",
        description: "Live visibility into what's blocking the chain, and a defensible record of every exception.",
        capabilities: ["Policy-configurable readiness rules", "Exception-case queue", "Content-hashed audit snapshots"],
        requirementCount: 15,
      },
      {
        id: "procurement-analytics",
        name: "Spend & risk analytics",
        description: "A 12-report registry covering spend, risk, and cycle time.",
        capabilities: ["Spend analysis and maverick-spend detection", "Matching-exception and supplier-risk reporting", "Cycle-time analysis"],
        requirementCount: 10,
      },
    ],
    primaryWorkflow: {
      name: "Requisition to Purchase Order",
      trigger: "An employee submits a purchase requisition.",
      steps: [
        { step: "Submit", detail: "The requisition enters the draft-submit-approve-execute state machine." },
        { step: "Approve", detail: "The requisition is approved by policy, with self-approval blocked." },
        { step: "Source", detail: "For competitive spend, an RFQ is issued, bids are evaluated, and a supplier is awarded." },
        { step: "Order", detail: "A purchase order is issued to the awarded or approved supplier." },
        { step: "Receive", detail: "Goods are received and matched against the PO under 2/3/4-way matching rules." },
        { step: "Hand off to AP", detail: "Only a matched receipt can feed a vendor bill into Accounting." },
      ],
      approvals: ["Self-approval is blocked at every governed step of the requisition-to-order chain."],
      automatedActions: ["Exception-case creation on match failure", "Readiness scoring across the requisition-to-payment chain"],
      connectedModuleKeys: ["accounting", "stock"],
      outcome: "A matched receipt that gates AP bill creation — no bill reaches Accounts Payable until the numbers actually reconcile.",
    },
    connectedModules: [
      { moduleKey: "accounting", relationship: "A matched receipt is required before Accounting can import a vendor bill — a confirmed, enforced dependency." },
      { moduleKey: "stock", relationship: "Reorder rules reference a supplier, but there's no automatic requisition job from Stock today — the link is a reference, not a live trigger." },
      { moduleKey: "quality", relationship: "Incoming receipts can route through a Quality inspection before they're accepted into stock." },
    ],
    reporting: [
      { name: "Spend analysis", measures: "Total and category spend over time", audience: "Procurement managers" },
      { name: "Maverick spend", measures: "Purchases made outside approved suppliers or process", audience: "Procurement, finance" },
      { name: "Matching exceptions", measures: "Receipts and bills stuck on variance", audience: "AP staff, receiving clerks" },
      { name: "Supplier risk", measures: "Scorecard trends and qualification status", audience: "Sourcing buyers" },
      { name: "Cycle time", measures: "Time from requisition to order to receipt", audience: "Procurement leadership" },
    ],
    automation: [
      { title: "Self-approval blocking", description: "The person who submits a requisition or order cannot approve it themselves." },
      { title: "Automatic exception-case creation", description: "A matching failure automatically opens an exception case instead of silently blocking with no record." },
      { title: "Readiness scoring", description: "Every stage of the requisition-to-payment chain is scored for whether it's actually ready to proceed." },
    ],
    governance: [
      { title: "Fine-grained per-resource permissions", description: "Access is controlled per resource and action, not one blanket 'procurement' role." },
      { title: "Self-approval prevention", description: "Enforced structurally at every governed transition, not just documented as policy." },
      { title: "Append-only, content-hashed audit trail", description: "Governance snapshots are hashed, so a change to the historical record would be detectable." },
    ],
    implementationConsiderations: [
      "Approved supplier lists, qualification criteria, and approval policies are configured before go-live.",
      "Matching tolerances per category are set to match how much variance your business actually accepts.",
      "Existing open requisitions and purchase orders are migrated, not re-created.",
      "There is no dedicated mobile navigation entry for Procurement today — plan for desktop/browser access.",
    ],
    faqs: [
      { question: "Can a vendor bill be paid before it's matched?", answer: "No — 2/3/4-way matching with per-line variance tolerance gates every bill before it can be imported into Accounts Payable; unresolved variance requires a mandatory-reason override, not a silent bypass." },
      { question: "Does Procurement automatically create a requisition when stock runs low?", answer: "Not automatically — Stock's reorder rules reference a preferred supplier, but there's no automatic requisition job triggered from Stock today. Replenishment decisions are still a deliberate step." },
      { question: "Is Procurement available on mobile?", answer: "No dedicated mobile navigation entry exists for Procurement — only a generic fallback resource list. Treat it as a desktop/browser workflow today." },
    ],
    screenshots: { primary: "procurement-orders-list" },
    conversion: { heading: "See how Vercentlabs Procurement would run your requisition-to-payment chain.", ctaLabel: "Book a Product Demo" },
  },

  stock: {
    navGroup: "operations",
    personas: ["Warehouse/inventory staff", "Inventory planners", "Operations managers"],
    painPoints: [
      "Stockouts and overstock",
      "No multi-warehouse visibility",
      "Batch/serial traceability gaps",
    ],
    bestAngle:
      "One shared, race-safe inventory ledger that Manufacturing and Point of Sale both post into live, with row-locked balance updates that prevent over-issuing.",
    accentColor: { hex: "#b45309", soft: "#fef3e2", sourcedFromProduct: false },
    directDefinition:
      "The Vercentlabs Stock module is a real-time, multi-location inventory ledger that tracks on-hand quantity, reservation, and valuation per item, warehouse, bin, and batch — one shared ledger that Manufacturing and Point of Sale post real movements into.",
    heroVariant: "dashboard-led",
    searchIntent: "Inventory and warehouse ERP",
    metaDescription:
      "Vercentlabs Stock is a real-time, race-safe inventory ledger with batch/serial traceability, multi-warehouse bin structure, and moving-average or FIFO valuation.",
    businessProblems: [
      { title: "Stockouts and overstock", description: "Without a live, accurate count, ordering decisions are guesses — you either run out or tie up cash in excess inventory." },
      { title: "No multi-warehouse visibility", description: "One location's stock is invisible to another, so transfers and fulfillment decisions happen blind." },
      { title: "Batch/serial traceability gaps", description: "When a defect surfaces, tracing which batch or serial it came from — and where else it went — takes hours instead of minutes." },
      { title: "Unbalanced adjustments", description: "Manual stock corrections happen with no consistent record of why the number changed." },
    ],
    businessOutcomes: [
      { title: "A number you can trust in real time", description: "Row-locked movement posting means two simultaneous transactions can't both succeed against stock that isn't there." },
      { title: "Visibility across every warehouse and bin", description: "Typed warehouses and a hierarchical bin structure make stock searchable down to its physical location." },
      { title: "Traceability when it matters", description: "Batch and serial tracking connect a unit back to its receipt, and forward to wherever it shipped." },
      { title: "Consistent, costed valuation", description: "Configurable moving-average or FIFO costing keeps the stock value on the books defensible." },
    ],
    capabilityGroups: [
      {
        id: "stock-ledger",
        name: "Real-time ledger & balances",
        description: "The core of the module — a race-safe, row-locked movement ledger.",
        capabilities: ["Row-locked movement posting enforcing available-stock checks before it allows an issue"],
        requirementCount: 16,
      },
      {
        id: "stock-movement-types",
        name: "Movement types",
        description: "Every way stock changes, each permission-gated.",
        capabilities: ["Receipt, issue, transfer, adjustment, return, and count movements", "Atomic issue+receipt pair posting for transfers"],
        requirementCount: 16,
      },
      {
        id: "stock-costing",
        name: "Costing & valuation",
        description: "How the stock value on the books is calculated.",
        capabilities: ["Configurable moving-average or FIFO costing"],
        requirementCount: 12,
      },
      {
        id: "stock-traceability",
        name: "Traceability & reorder planning",
        description: "Following a unit through its life, and knowing when to reorder it.",
        capabilities: ["Batch and serial tracking", "Reservations", "Reorder rules feeding a low-stock dashboard"],
        requirementCount: 14,
      },
      {
        id: "stock-warehouse-structure",
        name: "Warehouse & bin structure",
        description: "Where stock physically lives.",
        capabilities: ["Typed warehouses", "Hierarchical bin structure"],
        requirementCount: 12,
      },
    ],
    primaryWorkflow: {
      name: "Receipt to Fulfilment",
      trigger: "A purchase order receipt, a production output, or a transfer request arrives.",
      steps: [
        { step: "Post receipt", detail: "The movement posts under a row lock, updating on-hand balance for that item/warehouse/bin." },
        { step: "Put away", detail: "Stock is assigned to a bin within the warehouse's hierarchical structure." },
        { step: "Reserve", detail: "Stock can be reserved against a pending demand without being physically moved yet." },
        { step: "Issue or transfer", detail: "An issue or transfer posts only if the available-stock check clears — no over-issuing." },
        { step: "Value", detail: "Moving-average or FIFO costing keeps the valuation current with every movement." },
      ],
      approvals: ["Movements are permission-gated by type, but Stock has no approval workflow of its own — thinner governance than Procurement by design."],
      automatedActions: ["Transfer completion auto-posts the matching issue/receipt pair", "Reorder rules feed a low-stock dashboard"],
      connectedModuleKeys: ["manufacturing", "point-of-sale"],
      outcome: "An accurate, race-safe on-hand balance that Manufacturing and Point of Sale can both post real movements into, live.",
    },
    connectedModules: [
      { moduleKey: "manufacturing", relationship: "Manufacturing posts real, auditable material-issue and finished-goods movements directly into the Stock ledger — a confirmed, wired connection." },
      { moduleKey: "point-of-sale", relationship: "Every POS checkout deducts real inventory in the same database transaction as the sale — a confirmed, wired connection." },
      { moduleKey: "sales", relationship: "Sales order lines carry a warehouse reference, but standard order fulfillment does not yet call a stock-movement post — this link is not yet wired end to end." },
    ],
    reporting: [
      { name: "Stock overview dashboard", measures: "On-hand quantity, reserved quantity, valuation, and low-stock count", audience: "Warehouse staff, inventory planners" },
    ],
    automation: [
      { title: "Atomic transfer posting", description: "Completing a transfer automatically posts the matching issue and receipt as one pair — never one without the other." },
      { title: "Reorder rules", description: "Configured reorder points feed a live low-stock dashboard for planners." },
    ],
    governance: [
      { title: "Permission-gated movements", description: "Every movement type is gated by permission, enforced at the row level." },
      { title: "Idempotency keys", description: "Movement posting uses idempotency keys to prevent a retried request from double-posting." },
      { title: "No dedicated approval workflow", description: "Unlike Procurement, Stock does not have its own approval chain today — access control is the primary governance layer." },
    ],
    implementationConsiderations: [
      "Warehouse and bin structures are set up to match your actual physical layout before go-live.",
      "Opening stock balances are migrated and reconciled against a physical count, not estimated.",
      "Costing method (moving-average or FIFO) is chosen per item category.",
      "Stock has no mobile navigation entry today — plan for desktop/browser or handheld-scanner-via-browser workflows.",
    ],
    faqs: [
      { question: "Does a Sales order automatically reduce stock?", answer: "Not yet for standard order fulfillment — order lines carry a warehouse reference, but no stock-movement call has been found in that path. Manufacturing and Point of Sale are the two flows confirmed to post real stock movements today." },
      { question: "How is stock kept accurate under concurrent activity?", answer: "Movement posting is row-locked and enforces an available-stock check before it allows an issue, so two simultaneous transactions can't both succeed against stock that isn't there." },
      { question: "Is Stock accessible on mobile?", answer: "No — Stock has zero entries in the mobile navigation today. It's a desktop/browser workflow." },
    ],
    screenshots: { primary: "stock-overview" },
    conversion: { heading: "See how Vercentlabs Stock would run your warehouse and inventory ledger.", ctaLabel: "Book a Product Demo" },
  },

  manufacturing: {
    navGroup: "operations",
    personas: ["Production planners", "Shop-floor supervisors", "Plant managers"],
    painPoints: [
      "Stale or unapproved product structures",
      "Releasing work that can't actually be built",
      "Manual inventory adjustments for production",
    ],
    bestAngle:
      "A work order cannot be released without proven component availability, and every material issue and finished-goods receipt posts as a real, auditable stock movement.",
    accentColor: { hex: "#c2410c", soft: "#fef0e7", sourcedFromProduct: false },
    directDefinition:
      "The Vercentlabs Manufacturing module plans bills of materials and work orders, executes shop-floor production, and posts material consumption and finished-goods output directly into the live Stock ledger — not a paper work-order tracker sitting beside a separately managed inventory.",
    heroVariant: "operational-sequence",
    searchIntent: "Manufacturing ERP",
    metaDescription:
      "Vercentlabs Manufacturing manages versioned BOMs, routings, and work orders, and posts every material issue and finished-goods receipt as a real, shortage-guarded stock movement.",
    businessProblems: [
      { title: "Stale or unapproved product structures", description: "A bill of materials gets used in production even though it was never formally approved, or an old version is used by mistake." },
      { title: "Releasing work that can't actually be built", description: "A work order is released to the floor, and only then does someone discover a component is short." },
      { title: "Manual inventory adjustments for production", description: "Material consumption and finished-goods output get entered into inventory as a separate manual step, disconnected from what actually happened on the floor." },
      { title: "Blind material shortages", description: "There's no forward view of what production will need until it's already overdue." },
    ],
    businessOutcomes: [
      { title: "Production runs on approved structures", description: "A draft-to-active BOM lifecycle enforces one active BOM per item, with scrap percentage and issue method captured explicitly." },
      { title: "Nothing gets released it can't finish", description: "A work order can't move to released without proven component availability against the active BOM." },
      { title: "Inventory reflects the shop floor automatically", description: "Every material issue and finished-goods receipt posts as a real, auditable stock movement — not a separate reconciliation step." },
      { title: "Forward visibility into shortages", description: "Material and capacity planning runs produce recommended purchase, manufacture, or transfer actions before a shortage becomes a stoppage." },
    ],
    capabilityGroups: [
      {
        id: "manufacturing-bom",
        name: "Bill of materials management",
        description: "The versioned product structure production is built against.",
        capabilities: ["Versioned, multi-component BOMs with scrap percentage", "Manual or backflush issue method", "Draft-to-active lifecycle with one active BOM per item enforced"],
        requirementCount: 18,
      },
      {
        id: "manufacturing-routings",
        name: "Routings & work centers",
        description: "The sequence of operations and where they happen.",
        capabilities: ["Ordered operations with timing and capacity", "Work-center rate configuration"],
        requirementCount: 12,
      },
      {
        id: "manufacturing-work-order",
        name: "Work order lifecycle",
        description: "From plan to completed production, with materials and operations locked in at release.",
        capabilities: ["Draft-planned-released-in_progress-completed lifecycle", "Materials and operations snapshotted from the active BOM/routing at release"],
        requirementCount: 18,
      },
      {
        id: "manufacturing-production-posting",
        name: "Production posting",
        description: "Where the shop floor becomes a real, auditable inventory transaction.",
        capabilities: ["Per-unit material issue and finished-goods receipt", "Shortage and over-production guards"],
        requirementCount: 16,
      },
      {
        id: "manufacturing-planning",
        name: "Material & capacity planning",
        description: "Forward visibility instead of reacting to a stoppage.",
        capabilities: ["MRP-style planning runs", "Recommended purchase, manufacture, or transfer actions"],
        requirementCount: 12,
      },
      {
        id: "manufacturing-costing",
        name: "Costing",
        description: "Knowing what a work order actually costs, not just what it was planned to cost.",
        capabilities: ["Cost snapshots at planned, actual, and completion checkpoints"],
        requirementCount: 4,
      },
    ],
    primaryWorkflow: {
      name: "Demand to Production",
      trigger: "Demand is identified (a planning run recommendation, or a direct work-order creation).",
      steps: [
        { step: "Plan", detail: "A work order is created from the active BOM, snapshotting its components and routing." },
        { step: "Check availability", detail: "The work order cannot move to released without proven component availability." },
        { step: "Release and execute", detail: "The work order moves through in_progress as operations complete." },
        { step: "Post production", detail: "Material issues and finished-goods receipts post as real, shortage-guarded stock movements." },
        { step: "Cost and complete", detail: "Actual costs are captured at completion against the planned snapshot." },
      ],
      approvals: ["Policy toggles (allow_overproduction, backflush_materials) govern how strictly production posting is enforced."],
      automatedActions: ["Event-sourced audit trail on every state change", "Shortage and over-production guards at posting time"],
      connectedModuleKeys: ["stock", "quality"],
      outcome: "Finished goods received into a live, auditable stock ledger — with no manual inventory reconciliation step required.",
    },
    connectedModules: [
      { moduleKey: "stock", relationship: "Every material issue and finished-goods receipt posts a real, FK-linked stock movement — a confirmed, wired connection, not a reporting-only link." },
      { moduleKey: "quality", relationship: "Work orders and production postings can be a source for a Quality inspection point (in-process or final)." },
      { moduleKey: "accounting", relationship: "Cost snapshots at completion feed into product costing, though Manufacturing does not post journal entries directly." },
    ],
    reporting: [
      { name: "Production dashboard", measures: "Active, planned, and completed work orders, and a live shortage count", audience: "Production planners, plant managers" },
    ],
    automation: [
      { title: "Event-sourced audit trail", description: "Every work-order state change is captured in an append-only event log." },
      { title: "Shortage and over-production guards", description: "Production posting enforces guards so a work order can't post more material or output than it should." },
      { title: "MRP-style planning runs", description: "Planning runs are manual to trigger, but produce recommended purchase/manufacture/transfer/expedite actions once run — there is no background scheduler." },
    ],
    governance: [
      { title: "Fine-grained permissions with owner bypass", description: "Permissions are granular, with a defined owner-bypass path for exceptional cases." },
      { title: "Forced row-level security", description: "Data access is enforced at the database row level, not just filtered in the application." },
      { title: "State-machine guards", description: "A work order can't skip lifecycle states — release requires proven availability, and completion requires the prior states to have happened." },
    ],
    implementationConsiderations: [
      "Bills of materials and routings need to be built and approved (draft-to-active) before production can be planned against them.",
      "Work centers, capacity, and standard rates are configured to match your actual shop floor.",
      "Backflush vs. manual issue method is decided per BOM based on your traceability needs.",
      "Manufacturing has no mobile presence today — it is a web-only workflow.",
    ],
    faqs: [
      { question: "Can a work order be released without enough material on hand?", answer: "No — release is blocked without proven component availability against the active BOM, unless the allow_overproduction/backflush policy toggles are explicitly configured otherwise." },
      { question: "Does production update inventory automatically?", answer: "Yes — every material issue and finished-goods receipt posts as a real, auditable stock movement in the same system, not a separate manual reconciliation step." },
      { question: "Is there a scheduler that runs MRP automatically?", answer: "No — planning runs are triggered manually and produce recommended actions; there is no background scheduler running them on a cadence today." },
    ],
    screenshots: { primary: "manufacturing-dashboard" },
    conversion: { heading: "See how Vercentlabs Manufacturing would run your demand-to-production process.", ctaLabel: "Book a Product Demo" },
  },

  projects: {
    navGroup: "delivery",
    personas: ["Project/delivery managers", "Consultants logging time", "Finance/PMO staff"],
    painPoints: [
      "Not knowing project profitability until after close",
      "Double-entering billing into Sales/Accounting",
      "Budget overruns discovered too late",
    ],
    bestAngle:
      "Live gross margin, computed from approved labor, expense, and procurement actuals against contracted revenue, while the project is still open.",
    accentColor: { hex: "#7e22ce", soft: "#f6edfe", sourcedFromProduct: false },
    directDefinition:
      "The Vercentlabs Projects module plans, staffs, executes, and financially tracks billable and internal projects, connecting tasks and timesheets to real project cost and margin as the work happens, not after close.",
    heroVariant: "workflow-led",
    searchIntent: "Project management ERP",
    metaDescription:
      "Vercentlabs Projects tracks staffing, tasks, time, and budget, with live gross-margin calculated from approved labor, expense, and procurement actuals while the project is still open.",
    businessProblems: [
      { title: "Profitability is a surprise at close", description: "You don't know whether a project actually made money until the books are closed and it's too late to change course." },
      { title: "Billing gets double-entered", description: "Billable work is tracked in a project tool and re-entered into Sales or Accounting to actually invoice it." },
      { title: "Budget overruns surface too late", description: "Labor and expense run over budget quietly, and nobody notices until the project is already behind." },
      { title: "Unclear timesheet accountability", description: "Time entries get approved without a clear record of who signed off, or whether the person logging the time approved their own entry." },
    ],
    businessOutcomes: [
      { title: "Real-time margin, not a post-mortem", description: "Gross margin is computed live from approved labor, expense, and procurement actuals against contracted revenue — while the project is still open." },
      { title: "One billing handoff, not two", description: "Billing milestones use idempotency keys to hand off to Sales/Accounting without a duplicate entry." },
      { title: "Budget visibility before it's a problem", description: "Versioned budgets split labor, expense, procurement, contingency, and revenue, so overruns are visible against a specific line, early." },
      { title: "Accountable time entry", description: "The person who logs a time entry cannot approve their own entry." },
    ],
    capabilityGroups: [
      {
        id: "projects-setup",
        name: "Project setup & staffing",
        description: "How a project is defined and connected to the commercial record that funds it.",
        capabilities: ["Fixed, T&M, milestone, or non-billable billing method", "Customer and Sales-order linkage"],
        requirementCount: 12,
      },
      {
        id: "projects-work-breakdown",
        name: "Work breakdown",
        description: "Breaking the project into trackable pieces.",
        capabilities: ["Tasks and milestones", "Subtasking"],
        requirementCount: 10,
      },
      {
        id: "projects-time-expense",
        name: "Time & expense tracking",
        description: "The raw actuals that feed cost and billing.",
        capabilities: ["Time entries carrying both cost rate and bill rate", "Self-approval blocked on time entries"],
        requirementCount: 14,
      },
      {
        id: "projects-budgeting",
        name: "Budgeting",
        description: "A versioned plan to measure actuals against.",
        capabilities: ["Budgets split into labor, expense, procurement, contingency, and revenue"],
        requirementCount: 12,
      },
      {
        id: "projects-profitability",
        name: "Profitability & billing",
        description: "The live financial picture of the project.",
        capabilities: ["Live gross-margin calc from approved actuals vs. billed revenue", "Idempotency-keyed billing milestones", "Completion blocked while tasks remain open"],
        requirementCount: 17,
      },
    ],
    primaryWorkflow: {
      name: "Plan to Delivery and Profitability",
      trigger: "A project is set up, linked to a customer and (optionally) a Sales order.",
      steps: [
        { step: "Staff and budget", detail: "The project is staffed, and a versioned budget is set across labor, expense, procurement, and contingency." },
        { step: "Break down work", detail: "Tasks and milestones define the deliverables." },
        { step: "Track time and expense", detail: "Consultants log time and expenses; self-approval is blocked." },
        { step: "Feed real actuals", detail: "Approved labor, expense, and linked procurement actuals compute live gross margin against contracted revenue." },
        { step: "Bill", detail: "Idempotency-keyed billing milestones hand off to Sales/Accounting without duplicate entry." },
        { step: "Close", detail: "A project cannot be marked complete while tasks remain open." },
      ],
      approvals: ["The person who logs a time entry cannot approve it themselves."],
      automatedActions: ["Live gross-margin recalculation as actuals post", "Completion blocked with open tasks"],
      connectedModuleKeys: ["accounting", "procurement", "hr-payroll", "sales"],
      outcome: "A closed, profitable (or honestly unprofitable) project with a billing history that never required re-keying into Sales or Accounting.",
    },
    connectedModules: [
      { moduleKey: "procurement", relationship: "Linked procurement records feed real actuals into project profitability — a confirmed, wired connection, not an estimate." },
      { moduleKey: "sales", relationship: "Projects can link to a Sales order, and billing milestones hand off through the same idempotent request pattern Sales uses." },
      { moduleKey: "support", relationship: "Support tickets can reference the related project, giving service context on delivery issues." },
    ],
    reporting: [
      { name: "Project dashboard", measures: "Status, budget consumption, and open tasks across active projects", audience: "PMO, delivery managers" },
      { name: "Per-project profitability", measures: "Live gross margin against contracted revenue", audience: "Finance, delivery managers" },
    ],
    automation: [
      { title: "Live margin recalculation", description: "Gross margin recalculates as approved actuals post, not just at project close." },
      { title: "Completion guard", description: "A hard rule blocks marking a project complete while it still has open tasks." },
      { title: "Self-approval block on time entries", description: "Enforced at the data layer, not just a UI convention." },
    ],
    governance: [
      { title: "Broad permission surface", description: "Access is controlled per project function — staffing, budgeting, billing — not one blanket role." },
      { title: "Self-approval blocking", description: "Applies to time-entry approval specifically, preventing a conflict of interest in cost reporting." },
      { title: "RLS-enforced audit log", description: "Row-level security backs the audit log, so history can't be edited around the access controls." },
    ],
    implementationConsiderations: [
      "Billing methods (fixed/T&M/milestone/non-billable) are configured per project type before go-live.",
      "Cost and bill rates are set up per role or per employee, depending on how you actually price work.",
      "Existing in-flight projects are migrated with their actuals-to-date, not restarted from zero.",
      "Projects has no mobile presence today — a real gap for field-based time entry; plan for browser access.",
    ],
    faqs: [
      { question: "Can I see project profitability before the project closes?", answer: "Yes — gross margin is computed live from approved labor, expense, and procurement actuals against contracted revenue while the project is still open, not just as a post-close report." },
      { question: "Does project billing require re-entering data into Sales or Accounting?", answer: "No — billing milestones use idempotency keys to hand off, so the same billing event can't be entered (or double-billed) twice across systems." },
      { question: "Is there a mobile app for logging project time in the field?", answer: "Not today — Projects has no native mobile presence, which is a real gap for field-based time entry. Time tracking is a browser workflow." },
    ],
    screenshots: { primary: "projects-dashboard" },
    conversion: { heading: "See how Vercentlabs Projects would track your delivery and profitability.", ctaLabel: "Book a Product Demo" },
  },

  assets: {
    navGroup: "finance",
    personas: ["Facilities/IT/operations managers", "Maintenance technicians", "Finance/asset controllers"],
    painPoints: [
      "Unclear custody of equipment",
      "Unproven preventive maintenance",
      "Unauditable capitalization and disposal",
    ],
    bestAngle:
      "Acquisition through capitalization, custodian assignment, maintenance with real labor/parts/external cost capture, and disposal with computed gain or loss — with self-approval blocked at every governed step.",
    accentColor: { hex: "#4d7c0f", soft: "#f2f8e8", sourcedFromProduct: false },
    directDefinition:
      "The Vercentlabs Assets module tracks and governs the full lifecycle of physical and equipment assets — acquisition, capitalization, assignment, maintenance, and disposal — with an audit trail on every state change and self-approval blocked at every governed step.",
    heroVariant: "operational-sequence",
    searchIntent: "Asset management ERP",
    metaDescription:
      "Vercentlabs Assets governs the equipment lifecycle from capitalization (self-approval blocked) through custodian assignment, maintenance with real cost capture, and disposal with computed gain or loss.",
    businessProblems: [
      { title: "Unclear custody of equipment", description: "Nobody can say with confidence who currently has a given piece of equipment, or when it changed hands." },
      { title: "Unproven preventive maintenance", description: "Maintenance happens, or doesn't, with no structured record of labor, parts, or cost — so you can't prove a warranty claim or plan a replacement." },
      { title: "Unauditable capitalization and disposal", description: "An asset gets capitalized or disposed of by whoever handled the transaction, with no separation between the person acting and the person approving." },
      { title: "Unmonitored warranty and maintenance windows", description: "Warranty expirations and maintenance-due dates aren't tracked centrally, so windows close unnoticed." },
    ],
    businessOutcomes: [
      { title: "A defensible chain of custody", description: "Assignment enforces one unique active assignment at a time, so custody is always a clear, current fact." },
      { title: "Maintenance you can actually prove", description: "Planned, preventive, and priority maintenance orders capture downtime hours and real labor, parts, and external cost." },
      { title: "Capitalization and disposal that can't self-approve", description: "The creator of an asset cannot capitalize it themselves, and disposal (with computed gain or loss) is also self-approval-blocked." },
      { title: "A due-window view before it's missed", description: "The dashboard surfaces warranties expiring and maintenance coming due, ahead of time." },
    ],
    capabilityGroups: [
      {
        id: "assets-register",
        name: "Asset register & categorization",
        description: "The core record of what you own and how it's classified.",
        capabilities: ["Structured asset register", "Category-based classification"],
        requirementCount: 10,
      },
      {
        id: "assets-capitalization",
        name: "Capitalization",
        description: "Moving an asset from draft to available, with a governance guard.",
        capabilities: ["Draft-to-available lifecycle", "Self-approval blocked — the creator cannot capitalize their own asset"],
        requirementCount: 12,
      },
      {
        id: "assets-assignment",
        name: "Assignment & custody",
        description: "Who currently has the asset, enforced as a single source of truth.",
        capabilities: ["Enforced-unique active assignment"],
        requirementCount: 8,
      },
      {
        id: "assets-maintenance",
        name: "Maintenance",
        description: "Planned and reactive maintenance with real cost capture.",
        capabilities: ["Planned, preventive, and priority maintenance orders", "Downtime-hour and labor/parts/external cost capture", "Parts consumption posts as a real Stock movement"],
        requirementCount: 16,
      },
      {
        id: "assets-disposal",
        name: "Disposal",
        description: "Retiring an asset with a computed, auditable financial outcome.",
        capabilities: ["Computed gain or loss on disposal", "Self-approval blocked, same as capitalization"],
        requirementCount: 10,
      },
      {
        id: "assets-inspections-transfers",
        name: "Inspections & transfers",
        description: "The data model exists; today these are read-only views, not a create workflow — an honest, current limitation.",
        capabilities: ["Inspection and transfer records (read-only today)"],
        requirementCount: 4,
      },
    ],
    primaryWorkflow: {
      name: "Acquisition to Maintenance and Disposal",
      trigger: "An asset is acquired, referencing its purchase order and receipt from Procurement.",
      steps: [
        { step: "Capitalize", detail: "The asset moves from draft to available — the creator cannot capitalize their own asset." },
        { step: "Assign custody", detail: "A named custodian is assigned, with only one active assignment enforced at a time." },
        { step: "Maintain", detail: "Planned, preventive, or priority maintenance orders capture downtime and real labor/parts/external cost; parts consumption posts a real Stock movement." },
        { step: "Dispose", detail: "Disposal computes gain or loss and is self-approval-blocked, just like capitalization." },
      ],
      approvals: ["Capitalization and disposal both block self-approval by the same person who initiated the action."],
      automatedActions: ["Due-window logic for warranties and maintenance", "Status-transition guards"],
      connectedModuleKeys: ["procurement", "stock", "support"],
      outcome: "A complete, audit-ready asset history from acquisition through disposal, with every governed step blocked from self-approval.",
    },
    connectedModules: [
      { moduleKey: "procurement", relationship: "Assets link to their originating purchase order, receipt, and vendor bill — a confirmed, wired connection." },
      { moduleKey: "stock", relationship: "Maintenance parts consumption posts as a real stock movement — a confirmed, wired connection." },
      { moduleKey: "support", relationship: "Support tickets carry a related-asset reference, so a service issue can be traced to the specific equipment." },
      { moduleKey: "accounting", relationship: "Identity fields align with the Accounting fixed-asset subledger but are not FK-joined — see the Accounting module page's Honest Limitations note before assuming a unified depreciation pipeline." },
    ],
    reporting: [
      { name: "Asset dashboard", measures: "Total assets, assigned count, in-maintenance count, warranties expiring, net book value, maintenance due", audience: "Facilities/IT managers, finance/asset controllers" },
    ],
    automation: [
      { title: "Due-window logic", description: "The dashboard surfaces warranties expiring and maintenance coming due before the window closes." },
      { title: "Status-transition guards", description: "An asset can't skip lifecycle states out of order." },
      { title: "Self-approval blocking", description: "Enforced structurally on both capitalization and disposal." },
    ],
    governance: [
      { title: "Full permission surface", description: "Every lifecycle action — capitalize, assign, maintain, dispose — is independently permissioned." },
      { title: "Immutable event log", description: "Every state change is logged and cannot be altered after the fact." },
      { title: "Forced row-level security", description: "Data access is enforced at the database row level." },
    ],
    implementationConsiderations: [
      "Asset categories and depreciation-relevant classification are set up before migrating the existing register.",
      "Existing custody assignments are migrated as a starting point, not re-established from scratch.",
      "Maintenance schedules (preventive intervals) are configured per asset category.",
      "Assets has no mobile presence today — plan for desktop/browser access, including for maintenance technicians.",
    ],
    faqs: [
      { question: "Can the same person who buys an asset also capitalize it?", answer: "No — capitalization blocks self-approval, so the creator of the asset record cannot be the one who moves it to available/capitalized status." },
      { question: "Are asset inspections and transfers fully automated today?", answer: "The data model exists for both, but no create-function has been found — they're read-only today, not a live create-workflow. This is an honest current limitation, not a planned feature described as shipped." },
      { question: "Is the Assets module connected to Accounting's fixed-asset depreciation?", answer: "Identity fields align but the two are not foreign-key joined — they're independent data models. Don't assume a single unified capitalization-to-depreciation pipeline." },
    ],
    screenshots: { primary: "assets-dashboard" },
    conversion: { heading: "See how Vercentlabs Assets would govern your equipment lifecycle.", ctaLabel: "Book a Product Demo" },
  },

  "point-of-sale": {
    navGroup: "revenue",
    personas: ["Store cashiers/associates", "Shift supervisors", "Store/finance admins"],
    painPoints: [
      "Disconnect between floor sales and back-office stock",
      "Unauthorized over/under-charging",
      "Indefensible end-of-day cash reconciliation",
    ],
    bestAngle:
      "Every checkout deducts real inventory in the same database transaction as the sale — no nightly sync, no phantom stock.",
    accentColor: { hex: "#be185d", soft: "#fdf0f5", sourcedFromProduct: false },
    directDefinition:
      "The Vercentlabs Point of Sale module is governed retail checkout — cashiers ring up sales, take mixed-tender payment, and reconcile cash, with every sale deducting real inventory in the same database transaction as the sale itself.",
    heroVariant: "workflow-led",
    searchIntent: "Point of sale ERP",
    metaDescription:
      "Vercentlabs Point of Sale runs checkout with mixed payments and shift/cash-drawer control, deducting real inventory in the same transaction as the sale — no nightly stock sync.",
    businessProblems: [
      { title: "Disconnect between floor sales and back-office stock", description: "The register says one thing is in stock; the warehouse system says another, and nobody's sure which to trust until a physical count." },
      { title: "Unauthorized over- or under-charging", description: "A price gets overridden at the register with no clear record of who approved it or why." },
      { title: "Indefensible end-of-day cash reconciliation", description: "Cash counts don't match the expected total, and there's no structured variance record to explain why." },
    ],
    businessOutcomes: [
      { title: "Inventory that's never out of sync", description: "Every checkout posts a stock deduction in the same transaction as the sale — not a nightly batch job that can fail silently." },
      { title: "Controlled price overrides", description: "A price-override permission gate means only authorized roles can change a price at the register." },
      { title: "Defensible cash reconciliation", description: "Shift close computes expected-vs-counted variance per payment method automatically." },
    ],
    capabilityGroups: [
      {
        id: "pos-checkout",
        name: "Checkout & cart completion",
        description: "The core sale transaction.",
        capabilities: ["Multi-line sale with mixed-tender payment", "Idempotency-key-protected checkout"],
        requirementCount: 20,
      },
      {
        id: "pos-shift-cash",
        name: "Shift & cash-drawer control",
        description: "Controlling who's operating a terminal and reconciling the drawer.",
        capabilities: ["Opening float and close-with-variance calculation", "One open shift per terminal enforced by a unique index"],
        requirementCount: 15,
      },
      {
        id: "pos-returns",
        name: "Returns & refunds",
        description: "Handling a return without losing control.",
        capabilities: ["Line-level returns", "Policy-gated return approval"],
        requirementCount: 12,
      },
      {
        id: "pos-setup",
        name: "Store/terminal/pricing setup",
        description: "Configuring how a store and its terminals operate.",
        capabilities: ["Store and terminal configuration", "Pricing setup"],
        requirementCount: 10,
      },
      {
        id: "pos-reconciliation",
        name: "Reconciliation",
        description: "Closing the day with a defensible number.",
        capabilities: ["Per-payment-method expected/counted/variance tracking"],
        requirementCount: 8,
      },
    ],
    primaryWorkflow: {
      name: "Checkout to Inventory and Finance",
      trigger: "A cashier opens a shift with a starting float.",
      steps: [
        { step: "Ring up", detail: "A multi-line sale is built with mixed-tender payment." },
        { step: "Checkout", detail: "The sale is completed under an idempotency key, posting a real stock deduction in the same transaction." },
        { step: "Handle exceptions", detail: "Returns are line-level and policy-gated; price overrides require the override permission." },
        { step: "Close shift", detail: "Cash and other tenders are counted; server-computed variance is recorded per payment method." },
      ],
      approvals: ["Price overrides require a dedicated permission gate.", "Returns above policy thresholds require approval."],
      automatedActions: ["Real-time stock deduction at checkout", "Server-computed cash-variance calculation at shift close"],
      connectedModuleKeys: ["stock"],
      outcome: "A completed sale with inventory already correct and a cash drawer that reconciles to a real, computed variance — not a guess.",
    },
    connectedModules: [
      { moduleKey: "stock", relationship: "Every sale line posts a real stock deduction in the same transaction as the checkout — a confirmed, wired connection." },
      { moduleKey: "sales", relationship: "POS sales carry sales-order and invoice reference columns, but they are not yet populated automatically — POS-to-Sales/Accounting is not a fully automated link today." },
    ],
    reporting: [
      { name: "POS dashboard", measures: "Sales, shift status, and cash variance", audience: "Shift supervisors, store admins" },
    ],
    automation: [
      { title: "Real-time inventory deduction", description: "Stock is deducted in the same database transaction as the sale, not a separate nightly sync." },
      { title: "Server-computed cash variance", description: "Expected-vs-counted variance is calculated automatically at shift close, per payment method." },
      { title: "Policy-driven return approval", description: "Returns above policy thresholds route to approval automatically." },
    ],
    governance: [
      { title: "Permission-gated pricing", description: "Price overrides require a dedicated permission, not a general 'cashier' role." },
      { title: "Forced row-level security", description: "Store and terminal data is isolated at the database level." },
      { title: "Idempotency-protected checkout", description: "A duplicate checkout request can't create a duplicate sale." },
    ],
    implementationConsiderations: [
      "Store, terminal, and pricing configuration is set up per location before go-live.",
      "Cash-drawer float amounts and variance-tolerance policy are agreed before rollout.",
      "Return policy thresholds are configured to match how much discretion you want at the register.",
      "Point of Sale is explicitly excluded from the mobile module catalog — it's a desktop/terminal workflow.",
    ],
    faqs: [
      { question: "Does a POS sale automatically reduce warehouse inventory?", answer: "Yes — every checkout posts a real stock deduction in the same database transaction as the sale, with no nightly sync step." },
      { question: "Does a POS sale automatically create a Sales order or Accounting invoice?", answer: "Not automatically — the linking columns exist on the POS sale record, but they're not populated by an automated process today. Treat POS as inventory-integrated, not fully books-integrated, until that link ships." },
      { question: "Is Point of Sale available on a mobile phone?", answer: "No — Point of Sale is explicitly excluded from the mobile module catalog. It's a desktop/terminal workflow." },
    ],
    screenshots: { primary: "point-of-sale-dashboard" },
    conversion: { heading: "See how Vercentlabs Point of Sale would connect checkout to your live inventory.", ctaLabel: "Book a Product Demo" },
  },

  quality: {
    navGroup: "operations",
    personas: ["QA inspectors", "QA managers / release authorities", "Supplier quality managers"],
    painPoints: [
      "Bad material or product silently entering stock or shipping",
      "No segregation of duties between inspection and release",
      "One-off defect notes instead of tracked corrective action",
    ],
    bestAngle:
      "The inspector cannot release their own inspection, and a failed inspection automatically places an inventory hold — spanning receiving, production, stock, and returns.",
    accentColor: { hex: "#15803d", soft: "#eaf8ef", sourcedFromProduct: false },
    directDefinition:
      "The Vercentlabs Quality module enforces inspection checkpoints and disposition control across incoming receipts, in-process manufacturing, stock, and returns, with governed release and CAPA-driven resolution — a genuine cross-module inspection framework, not a module-local checklist.",
    heroVariant: "workflow-led",
    searchIntent: "Quality management ERP",
    metaDescription:
      "Vercentlabs Quality governs inspection and release across receiving, production, stock, and returns, with hard-coded segregation of duties and automatic holds on failed inspections.",
    businessProblems: [
      { title: "Bad material or product silently enters stock or shipping", description: "Without a governed inspection checkpoint, defective incoming material or finished goods can move forward with nothing to stop them." },
      { title: "No segregation of duties between inspection and release", description: "The same person who inspects a lot can also release it, removing the independent check that segregation of duties is supposed to provide." },
      { title: "One-off defect notes instead of tracked corrective action", description: "A defect gets noted somewhere, but there's no structured non-conformance record, root cause, or corrective action that gets verified as effective." },
      { title: "No supplier performance visibility", description: "Supplier quality issues repeat because there's no structured scorecard or audit trail tying failures back to the source." },
    ],
    businessOutcomes: [
      { title: "No one signs off their own work", description: "Release is a separate, governed step from inspection completion, and the inspector cannot release their own inspection." },
      { title: "Automatic containment on failure", description: "A failed inspection automatically places an inventory hold — no manual flag to remember." },
      { title: "Tracked corrective action, not a note", description: "Severity-graded non-conformance links to a CAPA with root-cause analysis and effectiveness verification." },
      { title: "Supplier accountability with evidence", description: "Periodic scorecards and structured audits link findings directly to corrective action." },
    ],
    capabilityGroups: [
      {
        id: "quality-plans",
        name: "Quality plans & inspection points",
        description: "Reusable inspection definitions typed by where they apply.",
        capabilities: ["Plans typed by stage: incoming, in-process, final, stock audit, supplier, customer return"],
        requirementCount: 14,
      },
      {
        id: "quality-execution",
        name: "Inspection execution & release",
        description: "Where the segregation-of-duties control actually lives.",
        capabilities: ["Release is a separate, governed step from inspection completion"],
        requirementCount: 14,
      },
      {
        id: "quality-holds",
        name: "Holds & disposition",
        description: "What happens automatically when something fails.",
        capabilities: ["Automatic inventory hold on failed inspection (togglable)"],
        requirementCount: 12,
      },
      {
        id: "quality-nc-capa",
        name: "Non-conformance & CAPA",
        description: "Turning a defect into a tracked, verified fix.",
        capabilities: ["Severity-graded non-conformance", "Linked CAPA with root-cause analysis, corrective/preventive action, and effectiveness verification"],
        requirementCount: 16,
      },
      {
        id: "quality-supplier",
        name: "Supplier quality & audits",
        description: "Holding suppliers accountable with structured evidence.",
        capabilities: ["Periodic supplier scorecards", "Structured audits with findings linkable to CAPA"],
        requirementCount: 10,
      },
      {
        id: "quality-traceability",
        name: "Traceability",
        description: "A durable record of what happened, and when.",
        capabilities: ["Append-only quality event log"],
        requirementCount: 4,
      },
    ],
    primaryWorkflow: {
      name: "Inspection to CAPA",
      trigger: "A source event occurs — a receipt, a work order/production posting, a stock batch/serial, or a return.",
      steps: [
        { step: "Inspect", detail: "An inspection runs against the relevant quality plan for that stage." },
        { step: "Fail and hold", detail: "A failed inspection automatically places an inventory hold on the affected material." },
        { step: "Release (separate step)", detail: "Release requires a different person than the inspector — a hard-coded segregation of duties." },
        { step: "Raise non-conformance", detail: "A severity-graded NC record captures what went wrong." },
        { step: "CAPA", detail: "Root cause, corrective action, and preventive action are tracked through to verified effectiveness." },
      ],
      approvals: ["Release cannot be performed by the same person who completed the inspection."],
      automatedActions: ["Auto-hold on inspection failure (togglable)", "Append-only event logging"],
      connectedModuleKeys: ["procurement", "manufacturing", "stock", "sales"],
      outcome: "A defect that's contained automatically, tracked to root cause, and verified as actually fixed — not just noted and forgotten.",
    },
    connectedModules: [
      { moduleKey: "procurement", relationship: "Incoming receipts can be a source for a Quality inspection before material is accepted into stock." },
      { moduleKey: "manufacturing", relationship: "Work orders and production postings can be an in-process or final inspection source." },
      { moduleKey: "stock", relationship: "Stock batches and serials can be a source for a stock-audit inspection, and a failed inspection places a hold directly on that stock." },
      { moduleKey: "sales", relationship: "Sales and POS returns can route through a customer-return inspection for disposition." },
    ],
    reporting: [
      { name: "Quality dashboard", measures: "Open/failed/today's inspections, active holds, open NC/CAPA count", audience: "QA managers, plant quality engineers" },
    ],
    automation: [
      { title: "Auto-hold on failure", description: "A failed inspection automatically places an inventory hold, togglable per organization policy." },
      { title: "Hard-coded self-release block", description: "The system itself, not just a policy document, prevents an inspector from releasing their own inspection." },
    ],
    governance: [
      { title: "Segregation of duties on release", description: "The single most load-bearing control in the module — release requires a different person than the inspector." },
      { title: "Forced row-level security", description: "Quality records are isolated at the database row level." },
    ],
    implementationConsiderations: [
      "Quality plans and inspection points are defined per stage (incoming/in-process/final/stock-audit/supplier/customer-return) before go-live.",
      "Auto-hold policy is decided per organization — whether a failed inspection always holds stock or requires a manual step.",
      "CAPA workflows and severity grading are configured to match your existing quality process.",
      "Quality has no mobile presence today — it is a web-only workflow for inspectors.",
    ],
    faqs: [
      { question: "Can an inspector release their own failed inspection after fixing the issue?", answer: "No — release is a separate, governed step from inspection completion, and it requires a different person than the original inspector. This is hard-coded, not a configurable policy." },
      { question: "What happens automatically when an inspection fails?", answer: "An automatic inventory hold is placed on the affected material — batch, serial, receipt, work order, or return — so it can't move forward silently. This behavior is togglable per organization." },
      { question: "Does Quality only cover incoming receiving?", answer: "No — quality plans are typed by stage and span incoming, in-process manufacturing, final inspection, stock audits, supplier quality, and customer returns. It's a genuine cross-module framework, not a receiving-only checklist." },
    ],
    screenshots: { primary: "quality-dashboard" },
    conversion: { heading: "See how Vercentlabs Quality would govern inspection and release across your operations.", ctaLabel: "Book a Product Demo" },
  },

  support: {
    navGroup: "people-and-service",
    personas: ["Support agents", "Team leads / queue managers", "Service ops / CS managers"],
    painPoints: [
      "Silently missed SLA deadlines",
      "Agents lacking commercial context",
      "Tickets closed without documented resolution",
    ],
    bestAngle:
      "Every ticket automatically carries the customer's commercial context — CRM account, sales order, invoice, asset, and project — through first-class relationship fields.",
    accentColor: { hex: "#b91c1c", soft: "#fdeded", sourcedFromProduct: false },
    directDefinition:
      "The Vercentlabs Support module is a ticket-based system that tracks requests from creation through SLA-timed resolution, with full context links to the customer's account and the commercial record that triggered the issue — not a standalone helpdesk with no idea who the customer is.",
    heroVariant: "workflow-led",
    searchIntent: "Customer support ERP",
    metaDescription:
      "Vercentlabs Support tracks tickets through SLA-timed resolution with first-class links to the customer's account, sales order, invoice, asset, and project — a single customer-history view.",
    businessProblems: [
      { title: "SLA deadlines get missed silently", description: "A ticket sits past its due date with nobody alerted, because there's no policy-driven SLA clock actually running." },
      { title: "Agents lack commercial context", description: "An agent handling a ticket can't see the customer's order history, invoices, or account status, so every ticket starts from zero." },
      { title: "Tickets close without documented resolution", description: "A ticket gets marked resolved with no record of what was actually done, making the next similar issue harder to solve." },
    ],
    businessOutcomes: [
      { title: "SLA breaches are visible before they happen", description: "Named SLA policies count business hours only and pause on pending-customer status, so the clock reflects reality." },
      { title: "Every ticket carries commercial context automatically", description: "Tickets carry first-class links to the CRM account, sales order, invoice, asset, and project — aggregated into a dedicated customer-history view." },
      { title: "Resolution is documented, not assumed", description: "A guarded state machine requires a resolution code before a ticket can close." },
    ],
    capabilityGroups: [
      {
        id: "support-lifecycle",
        name: "Ticket lifecycle",
        description: "How a ticket moves from open to genuinely resolved.",
        capabilities: ["SLA-driven due-date calculation at intake", "Guarded state machine requiring a resolution code to close"],
        requirementCount: 16,
      },
      {
        id: "support-routing",
        name: "Routing & assignment",
        description: "Getting a ticket to the right agent.",
        capabilities: ["Queues with manual, round-robin, least-loaded, or skills-based assignment strategy"],
        requirementCount: 12,
      },
      {
        id: "support-sla",
        name: "SLA management",
        description: "Named policies that actually reflect business reality.",
        capabilities: ["Business-hours-only counting", "Pause-on-pending-customer status"],
        requirementCount: 12,
      },
      {
        id: "support-communications",
        name: "Communications",
        description: "Keeping the conversation and the internal notes both in context.",
        capabilities: ["Threaded messages", "Private internal notes"],
        requirementCount: 10,
      },
      {
        id: "support-knowledge-base",
        name: "Knowledge base",
        description: "Reusable answers, versioned and published deliberately.",
        capabilities: ["Versioned articles", "Draft-to-published lifecycle"],
        requirementCount: 10,
      },
      {
        id: "support-escalation",
        name: "Escalation tracking",
        description: "The schema exists; automated escalation triggering is not yet live — an honest current limitation.",
        capabilities: ["Escalation data model (not yet automated)"],
        requirementCount: 5,
      },
    ],
    primaryWorkflow: {
      name: "Ticket to Resolution",
      trigger: "A customer or internal user raises a support ticket.",
      steps: [
        { step: "Intake", detail: "The ticket is created with an SLA due date calculated at intake, and carries the customer's account context automatically." },
        { step: "Route", detail: "A queue strategy (manual, round-robin, least-loaded, or skills-based) assigns the ticket to an agent." },
        { step: "Work", detail: "The agent communicates via threaded messages, with private notes for internal context, referencing the full customer-history view." },
        { step: "Resolve", detail: "The ticket cannot close without a resolution code entered." },
      ],
      approvals: ["N/A — Support's governance is primarily about SLA discipline and permission gating rather than approval chains."],
      automatedActions: ["SLA due-date calculation at creation", "Business-hours-only SLA counting with pending-customer pause"],
      connectedModuleKeys: ["crm", "sales", "accounting", "assets", "projects", "quality"],
      outcome: "A resolved ticket with a documented resolution code, full commercial context, and an SLA record that reflects real business hours.",
    },
    connectedModules: [
      { moduleKey: "crm", relationship: "Tickets carry customer and contact IDs from CRM, so agents see the same account the sales team sees." },
      { moduleKey: "sales", relationship: "Tickets can reference the related sales order and invoice for commercial context on the issue." },
      { moduleKey: "assets", relationship: "A ticket can reference the specific asset involved, tracing a service issue back to actual equipment." },
      { moduleKey: "projects", relationship: "Tickets can reference a related project, giving delivery context on the issue." },
      { moduleKey: "quality", relationship: "Tickets can reference a related quality record, connecting a customer complaint to a formal non-conformance." },
    ],
    reporting: [
      { name: "Support dashboard", measures: "Open tickets, high-priority tickets, SLA breaches, escalations", audience: "Team leads, service ops managers" },
    ],
    automation: [
      { title: "SLA due-date calculation", description: "Computed automatically at ticket creation based on the applicable named SLA policy." },
      { title: "Business-hours-aware counting", description: "The SLA clock only counts business hours and pauses while a ticket is pending on the customer." },
      { title: "Breach detection", description: "Currently a live dashboard query rather than a push notification — visible on demand, not yet alerted automatically." },
    ],
    governance: [
      { title: "Per-action permission gating", description: "Ticket actions are permissioned individually, not by one blanket support-agent role." },
      { title: "Forced row-level security on 14 tables", description: "Support data is isolated at the row level across its full schema." },
    ],
    implementationConsiderations: [
      "SLA policies and business hours are configured per organization before go-live.",
      "Queue routing strategy (manual/round-robin/least-loaded/skills-based) is chosen per team.",
      "Resolution codes are defined to match how you actually categorize outcomes.",
      "Support is explicitly excluded from the mobile module catalog — plan for desktop/browser access.",
    ],
    faqs: [
      { question: "Can an agent see a customer's order history from a ticket?", answer: "Yes — tickets carry first-class relationship fields to the CRM account, sales order, invoice, asset, and project, aggregated into a dedicated customer-history view." },
      { question: "Can a ticket be closed without saying what was done?", answer: "No — a guarded state machine requires a resolution code before a ticket can transition to closed." },
      { question: "Is escalation fully automated?", answer: "Not yet — the escalation data model exists, but automated escalation triggering has not been found in the codebase. Treat escalation tracking as a schema-ready, not fully automated, capability today." },
    ],
    screenshots: { primary: "support-dashboard" },
    conversion: { heading: "See how Vercentlabs Support would connect tickets to your customer's commercial history.", ctaLabel: "Book a Product Demo" },
  },

  "hr-payroll": {
    navGroup: "people-and-service",
    personas: ["HR managers/admins", "Payroll preparers", "Line managers", "Employees"],
    painPoints: [
      "Employee master data in spreadsheets",
      "Manual leave-balance tracking",
      "Error-prone attendance-to-pay math",
    ],
    bestAngle:
      "Attendance-driven pay calculation with an immutable event trail and hard-coded separation of duties — no one approves their own leave or payroll run.",
    accentColor: { hex: "#a21caf", soft: "#fbeafd", sourcedFromProduct: false },
    directDefinition:
      "The Vercentlabs HR & Payroll module is a tenant- and company-scoped system of record for employee lifecycle, attendance and leave, and payroll processing, enforced through the same permission, audit, and separation-of-duties patterns as the rest of the platform.",
    heroVariant: "operational-sequence",
    searchIntent: "HR and payroll ERP",
    metaDescription:
      "Vercentlabs HR & Payroll tracks workforce structure, attendance-adjusted leave, and a self-approval-blocked payroll run, with statutory components and an immutable event trail.",
    businessProblems: [
      { title: "Employee master data lives in spreadsheets", description: "Basic employee records, reporting lines, and probation dates are tracked outside any system of record, with no single source of truth." },
      { title: "Manual leave-balance tracking", description: "Leave balances are calculated by hand, and mistakes compound over a year of accrual and usage." },
      { title: "Error-prone attendance-to-pay math", description: "Turning daily attendance into a correct payroll figure is manual and error-prone, especially with overtime." },
      { title: "No maker-checker on payroll or leave approval", description: "The same person who prepares a payroll run, or requests leave, can also approve it — removing an important control." },
    ],
    businessOutcomes: [
      { title: "One system of record for the workforce", description: "Departments, designations, shifts, and manager hierarchy are structured, not scattered across spreadsheets." },
      { title: "Leave balances that update themselves", description: "Balances deduct automatically on approval — no manual reconciliation." },
      { title: "Payroll calculated from real attendance", description: "Gross pay is calculated in one transaction from attendance-adjusted data, not assembled by hand from multiple sources." },
      { title: "A payroll process you can defend in an audit", description: "An immutable event trail and hard-coded separation of duties mean no one approves their own leave or payroll run." },
    ],
    capabilityGroups: [
      {
        id: "hr-workforce-structure",
        name: "Workforce structure",
        description: "The organizational scaffolding employee records sit inside.",
        capabilities: ["Departments, designations, shifts", "Manager hierarchy", "Probation and confirmation dates"],
        requirementCount: 16,
      },
      {
        id: "hr-attendance-leave",
        name: "Attendance & leave",
        description: "Daily attendance and leave, kept in sync automatically.",
        capabilities: ["Per-day status and overtime tracking", "Leave balances with automatic deduction on approval"],
        requirementCount: 18,
      },
      {
        id: "hr-compensation",
        name: "Compensation & statutory setup",
        description: "Pay structure and India-specific statutory compliance.",
        capabilities: ["Salary components with effective-dated history", "Jurisdiction-aware statutory components — PF/ESI/professional tax/TDS/gratuity/bonus"],
        requirementCount: 18,
      },
      {
        id: "hr-payroll-run",
        name: "Payroll run processing",
        description: "The governed run itself, from draft to posted.",
        capabilities: ["Draft-calculated-pending_approval-approved-posted lifecycle", "Attendance-adjusted gross-pay calculation in one transaction", "Self-approval blocked"],
        requirementCount: 16,
      },
      {
        id: "hr-expenses",
        name: "Employee expenses",
        description: "Expense records, exposed through the generic resource API.",
        capabilities: ["Employee expense tracking"],
        requirementCount: 2,
      },
    ],
    primaryWorkflow: {
      name: "Attendance to Payroll",
      trigger: "A payroll run is initiated for a pay period.",
      steps: [
        { step: "Track attendance", detail: "Per-day status and overtime are recorded through the period." },
        { step: "Apply leave", detail: "Approved leave automatically deducts from the employee's balance." },
        { step: "Calculate", detail: "Attendance-adjusted gross pay is calculated in one transaction, applying statutory components." },
        { step: "Approve", detail: "The run moves from calculated to pending_approval to approved — the preparer cannot approve their own run." },
        { step: "Post", detail: "The approved run posts, with a manual accounting-batch reference for finance reconciliation." },
      ],
      approvals: ["Self-approval is blocked for both leave requests and payroll runs — hard-coded, not a policy document."],
      automatedActions: ["Attendance-adjusted gross-pay calculation", "Automatic leave-balance deduction on approval"],
      connectedModuleKeys: ["accounting"],
      outcome: "A posted payroll run with an immutable event trail and a manual accounting-batch reference ready for finance reconciliation.",
    },
    connectedModules: [
      { moduleKey: "accounting", relationship: "A posted payroll run carries a manual accounting-batch reference field — a reference for reconciliation, not an automated GL-journal-posting call." },
      { moduleKey: "projects", relationship: "Employee cost/bill rates set up in HR inform how time entries are costed in Projects." },
    ],
    reporting: [
      { name: "HR dashboard", measures: "Active employees, on leave, new joiners, open payroll runs, latest net pay", audience: "HR managers, payroll preparers" },
    ],
    automation: [
      { title: "Attendance-adjusted payroll calculation", description: "Gross pay is calculated from real attendance data in one transaction, not assembled manually." },
      { title: "Automatic leave-balance updates", description: "Balances deduct on approval without a manual reconciliation step." },
      { title: "Self-approval blocking", description: "Applies to both leave approval and payroll-run approval." },
    ],
    governance: [
      { title: "19 distinct permission keys", description: "HR and payroll actions are permissioned individually, not through one blanket HR role." },
      { title: "Row locks before state transitions", description: "Prevents two people from processing the same payroll run simultaneously." },
      { title: "Immutable event log and hard-coded maker-checker", description: "Every action is logged, and the preparer/approver split is enforced structurally." },
    ],
    implementationConsiderations: [
      "Department, designation, and shift structures are set up before employee data is migrated in.",
      "Statutory components (PF/ESI/professional tax/TDS/gratuity/bonus) are configured per jurisdiction.",
      "Leave policies and accrual rules are configured to match your actual policy before balances are migrated.",
      "HR & Payroll is cataloged but explicitly excluded from the enabled mobile module list — no mobile access today.",
    ],
    faqs: [
      { question: "Can a payroll preparer approve their own run?", answer: "No — self-approval is blocked, hard-coded into the payroll-run lifecycle, not just documented as policy." },
      { question: "Does payroll posting automatically create a general-ledger journal entry?", answer: "No — a posted run carries a manual accounting-batch reference field for finance to reconcile against; there is no automated GL-journal-posting call found in the codebase today." },
      { question: "Is HR & Payroll accessible on mobile?", answer: "No — it's cataloged in the platform's module list but explicitly excluded from the enabled mobile modules, alongside Stock, as one of the two notable mobile-access gaps." },
    ],
    screenshots: { primary: "hr-payroll-dashboard" },
    conversion: { heading: "See how Vercentlabs HR & Payroll would run your attendance-to-payroll process.", ctaLabel: "Book a Product Demo" },
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
