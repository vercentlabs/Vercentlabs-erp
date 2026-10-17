/**
 * Cross-module workflows evidenced in docs/landing-redesign/phase-1/product-intelligence.md.
 * `modules` values must be valid keys from @vercentlabs/shared-types' ERP_MODULE_CATALOG.
 * `iaPriority` mirrors docs/landing-redesign/phase-1/information-architecture.md's Tier 3 table
 * (only priority P0/P1 workflows have a planned /workflows/{slug} page in the initial IA;
 * the rest are documented here for future phases, not yet routed).
 *
 * Phase 5 extends the 6 workflows that get a real page (lead-to-cash,
 * procure-to-pay, order-to-fulfilment, plan-to-production,
 * project-to-profitability, hire-to-payroll) with the richer page-level
 * fields (trigger, participants, sequence, automatedActions, approvals,
 * exceptions, visibility, businessValue, faqs, screenshotId) — see
 * docs/landing-redesign/phase-5/workflow-content-architecture.md. The other
 * 6 workflows keep their original minimal shape; they're still consumed by
 * getWorkflowsForModule() for module-page cross-links, just not routed to a
 * dedicated page this phase.
 *
 * order-to-fulfilment and hire-to-payroll are new this phase — no exact
 * equivalent existed in the original 12. Both are grounded directly in
 * product-intelligence.md's real module profiles and cross-module workflow
 * list (order-to-fulfilment is explicitly named as a "relevant workflow" for
 * ICP 2 in icp-and-buyer-map.md, just never previously routed).
 */
export const LANDING_WORKFLOWS = Object.freeze([
  {
    slug: "lead-to-cash",
    name: "Lead to Cash",
    modules: ["crm", "sales", "accounting"],
    summary:
      "A captured lead converts to an account and opportunity, progresses through a governed pipeline, becomes a publicly accepted quotation, converts to a credit-checked order, and posts a customer invoice.",
    iaPriority: "P0",
    directDefinition:
      "Lead to Cash is Vercentlabs ERP's real, cited sequence connecting CRM, Sales, and Accounting — the same system carries a captured lead through a publicly accepted quotation to a posted customer invoice, with no re-typed handoff between the three modules.",
    trigger: "A lead is captured from a public form, an import, or a signed webhook.",
    participants: ["Sales rep", "Sales approver (for over-threshold quotations)", "Buyer (customer)", "Finance/billing"],
    sequence: [
      { step: "Capture and score", moduleKey: "crm", detail: "The lead lands with source and campaign attribution intact, and is scored and SLA-tracked automatically." },
      { step: "Qualify and convert", moduleKey: "crm", detail: "Playbook-gated pipeline stage exit; one action creates the account, contact, and opportunity together." },
      { step: "Build the quotation", moduleKey: "sales", detail: "A GST-aware quotation is seeded from the won opportunity, with automatic CGST/SGST vs. IGST tax splitting by state." },
      { step: "Approve", moduleKey: "sales", detail: "Under-threshold quotations auto-approve; over-threshold quotations route to an approval request." },
      { step: "Accept publicly", moduleKey: "sales", detail: "The customer accepts or rejects via a public, single-use, hashed share link with a typed digital signature — no login required." },
      { step: "Convert to order", moduleKey: "sales", detail: "The accepted quotation converts to a sales order through an idempotent promotion — no duplicate orders on retry." },
      { step: "Credit check and confirm", moduleKey: "sales", detail: "The order is checked against real-time aggregated customer credit exposure, under an advisory database lock, before confirmation." },
      { step: "Invoice", moduleKey: "accounting", detail: "A customer invoice is generated from the confirmed order through an auditable, idempotent handoff." },
    ],
    automatedActions: [
      "Lead scoring and SLA due-date calculation",
      "Threshold-based quotation auto-approval",
      "Real-time aggregated credit-exposure check",
      "Idempotent invoice generation from the confirmed order",
    ],
    approvals: [
      "Quotations above the approval threshold route to a designated sales approver, not an open-ended email thread.",
      "Order confirmation is blocked outright if the customer's credit check fails.",
    ],
    exceptions: [
      "A quotation revision automatically cancels any pending approval on the prior version, so a stale draft can't get approved by accident.",
      "An order that would exceed the customer's credit exposure is held at confirmation, not silently accepted and discovered later at collection.",
    ],
    visibility: [
      "CRM's pipeline and forecast reports show stage-by-stage conversion by rep and team.",
      "Sales' quotation-conversion, expiring-quotations, and pending-approvals reports.",
      "Every quotation and order action writes an immutable, timestamped event row.",
    ],
    businessValue: [
      "A qualified lead reaches an invoiced order without a single re-typed handoff between CRM, Sales, and Accounting.",
      "Self-service, signature-backed quote acceptance removes a phone-tag round trip from the sales cycle.",
      "Credit risk is checked before commitment, not discovered at collection.",
    ],
    faqs: [
      { question: "Does confirming an order automatically deduct inventory?", answer: "Not for a standard sales order today — only Manufacturing and Point of Sale currently write to the stock ledger. Order lines carry a warehouse reference so fulfilment sees the same records, but the stock deduction itself is a separate, not-yet-automated step. See the Order to Fulfilment workflow for the honest detail." },
      { question: "What happens if a customer rejects the quotation instead of accepting it?", answer: "The public decision page records the rejection the same way it records acceptance — through the real API, with the event logged — rather than the quotation just sitting unresolved with no record of the outcome." },
      { question: "Is the credit check a hard block or just a warning?", answer: "It's enforced at order confirmation under an advisory database lock — an order that would exceed the customer's real-time aggregated credit exposure is blocked at that point, not flagged for someone to notice later." },
    ],
    screenshotId: "sales-quotation-detail",
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
    directDefinition:
      "Procure to Pay is Vercentlabs ERP's real, cited sequence connecting Procurement and Accounting — a purchase order can only become a vendor bill once matching confirms the order, receipt, and invoice actually agree.",
    trigger: "A requisition is raised for goods or services the business needs.",
    participants: ["Requesting employee", "Category/sourcing buyer", "Supplier", "Receiving clerk", "AP/finance staff"],
    sequence: [
      { step: "Requisition", moduleKey: "procurement", detail: "A requisition is drafted and submitted, entering a governed draft→submit→approve→execute state machine." },
      { step: "Sourcing (where used)", moduleKey: "procurement", detail: "Supplier RFQ invitations, bids, and evaluations can precede an award for competitively sourced spend." },
      { step: "Purchase order", moduleKey: "procurement", detail: "An approved order is created, then dispatched to the supplier and acknowledged, with a full amendment workflow if terms change." },
      { step: "Receipt", moduleKey: "procurement", detail: "Goods or services received against the acknowledged order are recorded." },
      { step: "Matching", moduleKey: "procurement", detail: "2, 3, or 4-way matching compares the order, receipt, and invoice, with per-line variance tolerance and a mandatory reason for any override." },
      { step: "Vendor bill", moduleKey: "accounting", detail: "A vendor bill can only be imported once matching confirms a 'matched' status — not before." },
      { step: "Payment", moduleKey: "accounting", detail: "The matched, posted bill is paid through Accounting's payables process." },
    ],
    automatedActions: [
      "Self-approval is blocked at every governed stage of the chain.",
      "A match failure automatically creates an exception case for resolution — it doesn't just fail silently.",
      "Policy-configurable readiness scoring runs continuously across the whole requisition-to-payment chain.",
    ],
    approvals: [
      "Purchase orders move through a governed approve → dispatch → acknowledge lifecycle, not an informal sign-off.",
      "A vendor bill cannot be created until the matching engine confirms 'matched' status.",
    ],
    exceptions: [
      "A matching variance outside tolerance requires a mandatory documented reason before an override is accepted — it can't be silently approved.",
      "Supplier qualification and activation are separate governed steps, kept apart from requisition creation itself.",
    ],
    visibility: [
      "A 12-report registry: spend analysis, maverick-spend detection, matching exceptions, supplier risk, and cycle time.",
      "Content-hashed governance audit snapshots at each stage of the chain.",
    ],
    businessValue: [
      "Real 2/3/4-way matching mechanically blocks AP bill creation on unresolved variance — not a policy someone has to remember to enforce.",
      "Live readiness scoring across the whole chain replaces a status-chasing email thread with a real dashboard.",
    ],
    faqs: [
      { question: "Can a requisition skip straight to a purchase order without sourcing?", answer: "Yes — sourcing/RFQ is part of the chain for competitively sourced spend, not a mandatory gate on every requisition. A direct requisition-to-PO path exists for routine purchases." },
      { question: "What stops someone from approving their own purchase order?", answer: "Self-approval is blocked structurally across the chain — the same person who creates a supplier, purchase order, or receipt cannot also approve or qualify it, enforced in the permission model, not left to policy." },
      { question: "Does Stock automatically reorder when it runs low?", answer: "No — reorder rules reference a preferred supplier and feed a low-stock dashboard, but there's no automatic requisition job triggered from Stock today. Replenishment is still a deliberate purchasing decision, made on real-time data." },
    ],
    screenshotId: "procurement-orders-list",
  },
  {
    slug: "order-to-fulfilment",
    name: "Order to Fulfilment",
    modules: ["sales", "stock", "accounting"],
    summary:
      "An accepted quotation converts to a credit-checked sales order, warehouse and production see the same order and item records, and an invoice is generated from the order through an auditable, idempotent handoff.",
    iaPriority: "P0",
    directDefinition:
      "Order to Fulfilment is Vercentlabs ERP's real, cited sequence covering what happens once a sales order exists — the warehouse and finance side of the process, distinct from Lead to Cash's revenue-team focus on getting the order signed in the first place.",
    trigger: "A sales quotation is accepted and converted to a sales order.",
    participants: ["Sales operations", "Warehouse/fulfilment staff", "Finance/billing"],
    sequence: [
      { step: "Order confirmed (see Lead to Cash)", moduleKey: "sales", detail: "An accepted quotation has already converted to a sales order and passed the real-time credit-exposure check — that conversion and credit-check step is Lead to Cash's, not repeated here. This workflow picks up from the confirmed order." },
      { step: "Readiness governance", moduleKey: "sales", detail: "The order's governance panel tracks readiness, fulfilment, invoicing, and closure state explicitly, rather than leaving status implicit." },
      { step: "Warehouse visibility", moduleKey: "stock", detail: "Order lines carry a warehouse reference, so warehouse and production see the same order and item records sales confirmed." },
      { step: "Invoice handoff", moduleKey: "accounting", detail: "The same auditable, idempotent invoice handoff Lead to Cash describes closes this workflow from the fulfilment side — no duplicate billing on retry." },
    ],
    automatedActions: [
      "Order conversion and the credit-exposure check are the same automations Lead to Cash covers — see that workflow for detail.",
      "Idempotent invoice-request generation from the confirmed order.",
    ],
    approvals: [
      "Order confirmation is blocked outright if the credit check fails.",
      "Amendments and return requests go through a controlled path, not a silent edit to a confirmed order.",
    ],
    exceptions: [
      "Standard sales-order fulfillment does not yet post an automatic stock deduction — order lines carry a warehouse reference, but only Manufacturing and Point of Sale currently write real movements to the stock ledger. This is stated plainly here, not implied away.",
    ],
    visibility: [
      "Sales' fulfilment and billing-readiness reports.",
      "Every order action writes an entry to the order's document event history.",
    ],
    businessValue: [
      "Warehouse and production see the same order and item records as sales confirmed — not a re-keyed picking list.",
      "Invoicing is idempotent and auditable, generated from the real order rather than a manually re-entered bill.",
    ],
    faqs: [
      { question: "Does this mean fulfilment is fully automated end to end?", answer: "No — the order and warehouse share the same real records, which removes re-keying, but the physical stock deduction for a standard sales order is not yet an automated step. Manufacturing and Point of Sale are the two flows that do post real stock movements today." },
      { question: "What happens if the customer wants to change the order after confirmation?", answer: "Amendments go through a controlled path in Sales' order governance, not a direct edit — so there's a record of what changed and when, not just an overwritten order." },
      { question: "Can an order be invoiced before it's fully confirmed?", answer: "No — invoice generation is triggered from a confirmed order via the idempotent handoff; it isn't a separate step someone can run early against an unconfirmed order." },
    ],
    screenshotId: "sales-order-detail",
  },
  {
    slug: "plan-to-production",
    name: "Plan to Production",
    modules: ["manufacturing", "stock"],
    summary:
      "A bill of materials becomes a work order; release is blocked on component shortage; every material issue and finished-goods receipt posts a real stock movement.",
    iaPriority: "P1",
    directDefinition:
      "Plan to Production is Vercentlabs ERP's real, cited sequence connecting Manufacturing and Stock — a released work order snapshots its bill of materials and cannot proceed without proven component availability, then posts real stock movements as it runs.",
    trigger: "An active bill of materials exists and a work order is created against it.",
    participants: ["Production planner", "Shop-floor supervisor", "Work-center operator"],
    sequence: [
      { step: "Activate the BOM", moduleKey: "manufacturing", detail: "One active bill of materials per item is enforced — there's no ambiguity about which structure a work order will snapshot from." },
      { step: "Create the work order", moduleKey: "manufacturing", detail: "Materials and operations are snapshotted from the active BOM and routing at creation time, not re-read live from a structure that could change mid-order." },
      { step: "Release", moduleKey: "manufacturing", detail: "Release is blocked if proven component availability can't be shown — a work order can't start against materials that aren't there." },
      { step: "Start", moduleKey: "manufacturing", detail: "The work order moves to in-progress on the shop floor." },
      { step: "Post production", moduleKey: "manufacturing", detail: "Material issue and finished-goods receipt post as real, auditable stock movements in the same transaction as the production event." },
    ],
    automatedActions: [
      "The release-blocking component-shortage check runs automatically, not as a manual pre-flight checklist.",
      "Every state transition writes to an event-sourced audit trail.",
      "Policy toggles control whether overproduction is allowed and whether component issue is manual or backflushed.",
    ],
    approvals: [
      "A released work order cannot proceed without proven component availability — the closest thing to an approval gate in this workflow, enforced structurally rather than by sign-off.",
    ],
    exceptions: [
      "Overproduction is blocked by default unless an organisation's policy explicitly allows it.",
      "Material requirements planning runs are triggered manually — there's no background scheduler running them on a cadence today.",
    ],
    visibility: [
      "A single dashboard shows active, planned, and completed work order counts and live material shortages.",
    ],
    businessValue: [
      "A released work order cannot proceed without proven component availability — not a paper work-order tracker sitting beside a separately managed inventory.",
      "Every material issue and finished-goods receipt is a real, auditable stock movement, posted in the same transaction as the production event.",
    ],
    faqs: [
      { question: "What happens if a work order is released without enough raw material?", answer: "It can't be — release is blocked outright if proven component availability can't be shown against the snapshotted BOM. This isn't a warning a planner can dismiss; it's a hard gate." },
      { question: "Is capacity planning automatic, or does someone run it?", answer: "Material and capacity planning runs produce recommended purchase, manufacture, transfer, or expedite actions, but they're triggered manually today — there's no automatic scheduler running MRP on a cadence." },
      { question: "Can more than one bill of materials be active for the same item at once?", answer: "No — one active BOM per item is enforced, so a work order always snapshots from a single, unambiguous structure." },
    ],
    screenshotId: "manufacturing-dashboard",
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
    modules: ["projects", "procurement", "accounting", "hr-payroll"],
    summary:
      "Approved timesheets, expenses, and procurement actuals compute live project gross margin against contracted revenue while the project is still open.",
    iaPriority: "P1",
    directDefinition:
      "Project Planning to Profitability is Vercentlabs ERP's real, cited sequence connecting Projects, Procurement, Accounting, and HR & Payroll — gross margin is computed live from approved actuals against contracted revenue while a project is still open, not reconstructed after it closes.",
    trigger: "A project is set up with a billing method and, where relevant, contracted revenue and a linked Sales order.",
    participants: ["Project/delivery manager", "Consultants and employees logging time/expenses", "Finance/PMO staff"],
    sequence: [
      { step: "Project setup", moduleKey: "projects", detail: "Billing method (fixed price, time & material, milestone, or non-billable) and customer/order linkage are set at creation." },
      { step: "Work breakdown", moduleKey: "projects", detail: "Tasks and milestones structure the delivery plan." },
      { step: "Time and expense", moduleKey: "projects", detail: "Time entries carry cost and bill rate; the person who logs an entry cannot approve their own entry." },
      { step: "Procurement actuals", moduleKey: "procurement", detail: "Real procurement actuals linked to the project feed into profitability, not a separately tracked spend estimate." },
      { step: "Live margin calculation", moduleKey: "projects", detail: "Gross margin is computed from approved labor, approved expenses, and real procurement actuals against contracted revenue — while the project is still open." },
      { step: "Billing milestone", moduleKey: "projects", detail: "An idempotency-keyed billing milestone hands off to Accounting — the same billing event can't be entered, or double-billed, twice." },
      { step: "Invoice", moduleKey: "accounting", detail: "Accounting posts the resulting customer invoice." },
    ],
    automatedActions: [
      "Live gross-margin calculation runs from approved actuals, not a manually rebuilt spreadsheet.",
      "A hard rule blocks marking a project complete while it still has open tasks.",
      "Billing milestones are idempotency-keyed against duplicate entry.",
    ],
    approvals: [
      "A timesheet or expense entry cannot be approved by the person who logged it.",
    ],
    exceptions: [
      "A project cannot be marked complete while it still has open tasks — a hard rule, not a warning a manager can override casually.",
    ],
    visibility: [
      "A per-project profitability report alongside the module dashboard's active/overdue project and task counts.",
    ],
    businessValue: [
      "Gross margin is visible while the project is still open, not discovered after close.",
      "Billing milestones can't be entered — or double-billed — twice, removing a real source of client-facing billing errors.",
    ],
    faqs: [
      { question: "Does margin only get calculated at project close?", answer: "No — it's a live calculation from approved labor, approved expenses, and real procurement actuals against contracted revenue, available at any point while the project is still open." },
      { question: "What stops someone from approving their own hours?", answer: "Self-approval is blocked structurally — the person who logs a time entry cannot also approve it, so cost data feeding the margin calculation isn't self-certified." },
      { question: "Can procurement spend on a project be missed from the margin calculation?", answer: "Real procurement actuals are linked to the project via project_procurement_links and feed directly into the profitability calculation — not tracked in a parallel spend estimate someone has to remember to reconcile." },
    ],
    screenshotId: "projects-dashboard",
  },
  {
    slug: "hire-to-payroll",
    name: "Hire to Payroll",
    modules: ["hr-payroll", "accounting"],
    summary:
      "An employee record moves through onboarding, compensation setup, and attendance tracking to an attendance-adjusted, maker-checker-governed payroll run.",
    iaPriority: "P0",
    directDefinition:
      "Hire to Payroll is Vercentlabs ERP's real, cited sequence connecting HR & Payroll and Accounting — attendance-adjusted pay is calculated in one transaction and a run cannot be approved by the person who prepared it, with a manual accounting-batch reference for finance to reconcile against.",
    trigger: "An employee record is created as part of onboarding.",
    participants: ["HR manager/admin", "Line manager", "Payroll preparer", "Payroll approver (a different person than the preparer)"],
    sequence: [
      { step: "Employee record", moduleKey: "hr-payroll", detail: "Workforce structure — department, designation, manager hierarchy, probation/confirmation dates — is set at onboarding." },
      { step: "Compensation setup", moduleKey: "hr-payroll", detail: "Salary components and jurisdiction-aware statutory components (PF, ESI, professional tax, TDS) are configured with effective-dated history." },
      { step: "Attendance and leave", moduleKey: "hr-payroll", detail: "Per-day attendance status and overtime are tracked; leave balances deduct automatically on approval." },
      { step: "Payroll run", moduleKey: "hr-payroll", detail: "A run moves through draft → calculated → pending_approval → approved → posted, with attendance-adjusted gross-pay calculated in one transaction." },
      { step: "Approval", moduleKey: "hr-payroll", detail: "A run cannot be approved by the person who prepared it — a different approver is required, enforced structurally." },
      { step: "Payslip", moduleKey: "hr-payroll", detail: "A posted run generates the employee's payslip." },
      { step: "Accounting reference", moduleKey: "accounting", detail: "A posted run carries a manual accounting-batch reference field for finance to reconcile against." },
    ],
    automatedActions: [
      "Attendance-adjusted gross-pay calculation runs in one transaction, not a manual spreadsheet formula.",
      "Leave balances update automatically on approval.",
    ],
    approvals: [
      "A payroll run cannot be approved by the person who prepared it.",
      "Leave requests cannot be approved by the person who submitted them.",
    ],
    exceptions: [
      "Posting to the general ledger is a manual accounting-batch reference field, not an automated journal-posting call — finance reconciles against the reference, it isn't posted on their behalf.",
    ],
    visibility: [
      "A dashboard showing active employees, employees on leave, new joiners, open payroll runs, and latest net pay.",
    ],
    businessValue: [
      "Payroll you can defend in an audit — attendance-driven pay calculation with hard-coded maker-checker control.",
      "An immutable event trail on every action, not a paper sign-off sheet.",
    ],
    faqs: [
      { question: "Does a posted payroll run automatically create a general-ledger journal entry?", answer: "No — a posted run carries a manual accounting-batch reference field for finance to reconcile against. There is no automated GL-journal-posting call found in the codebase today; this is a real, stated limitation, not an oversight in the copy." },
      { question: "Can the same person prepare and approve a payroll run to move faster?", answer: "No — a payroll run cannot be approved by the person who prepared it. This is enforced in the permission model, not left as a policy someone could bypass under time pressure." },
      { question: "Is HR & Payroll accessible on a phone for managers approving leave on the go?", answer: "No — HR & Payroll is cataloged in the platform's module list but explicitly excluded from the enabled mobile modules, alongside Stock. Leave and payroll approval are browser workflows today." },
    ],
    screenshotId: "hr-payroll-dashboard",
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

/** Slugs of the 6 workflows with a real /workflows/{slug} page this phase. */
export const ROUTED_WORKFLOW_SLUGS = Object.freeze([
  "lead-to-cash",
  "procure-to-pay",
  "order-to-fulfilment",
  "plan-to-production",
  "project-to-profitability",
  "hire-to-payroll",
]);

export function getWorkflowsForModule(moduleKey) {
  return LANDING_WORKFLOWS.filter((workflow) => workflow.modules.includes(moduleKey));
}

export function getWorkflow(slug) {
  return LANDING_WORKFLOWS.find((workflow) => workflow.slug === slug) || null;
}

export function getRoutedWorkflows() {
  return ROUTED_WORKFLOW_SLUGS.map((slug) => getWorkflow(slug)).filter(Boolean);
}
