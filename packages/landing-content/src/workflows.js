import { getLaunchCapability } from "./capabilities/launch-capabilities.js";

/**
 * Cross-module workflows. `modules` values must be valid keys from
 * @vercentlabs/shared-types' ERP_MODULE_CATALOG.
 *
 * Every step describes approved launch capabilities only. Routed workflows
 * (the ones with a /workflows/{slug} page) carry `capabilityIds` — the
 * capabilities/launch-capabilities.js register entries the sequence relies on — so a
 * workflow can't quietly describe functionality outside the approved scope.
 * Unrouted workflows keep a minimal shape and are only used for module-page
 * cross-links.
 *
 * Route slugs are kept stable for URL compatibility even where the display
 * name has changed (e.g. project-to-profitability is presented as
 * "Project to Delivery"); renaming routes belongs to the information
 * architecture phase.
 */
export const LANDING_WORKFLOWS = Object.freeze([
  {
    slug: "lead-to-cash",
    name: "Lead to Cash",
    modules: ["crm", "sales", "stock", "accounting"],
    summary:
      "A lead becomes an opportunity, a quotation, and a sales order, is delivered from stock, invoiced, paid, and posted to the general ledger — on one system, without re-typing the customer.",
    iaPriority: "P0",
    directDefinition:
      "Lead to Cash is the customer-to-cash sequence in Vercentlabs ERP, connecting CRM, Sales, Inventory, and Accounting — the same records carry a lead through quotation, order, delivery, and invoice to a customer receipt posted in the books.",
    trigger: "A new lead is entered or imported into CRM.",
    participants: ["Sales rep", "Order desk / sales operations", "Warehouse staff", "Finance / accounts receivable"],
    sequence: [
      { step: "Lead", moduleKey: "crm", detail: "The lead is assigned to an owner, qualified through its stages, and checked for duplicates." },
      { step: "Opportunity", moduleKey: "crm", detail: "The qualified lead converts into an opportunity that moves through the sales stages." },
      { step: "Quotation", moduleKey: "sales", detail: "The opportunity converts into a Sales quotation, with discounts and taxes applied." },
      { step: "Sales order", moduleKey: "sales", detail: "The accepted quotation becomes a sales order, confirmed after an availability check with stock reserved." },
      { step: "Delivery", moduleKey: "stock", detail: "The order is delivered from stock, and the shipment is recorded against it." },
      { step: "Invoice", moduleKey: "sales", detail: "A sales invoice is raised from the order instead of being re-keyed." },
      { step: "Receipt and posting", moduleKey: "accounting", detail: "The receivable posts to the general ledger, and the customer receipt is allocated against the invoice." },
    ],
    capabilityIds: [
      "crm-leads",
      "crm-lead-assignment",
      "crm-lead-qualification",
      "crm-duplicate-detection",
      "crm-lead-to-opportunity-conversion",
      "crm-opportunity-pipeline",
      "crm-opportunity-to-quotation-conversion",
      "sales-quotations",
      "sales-discounts",
      "sales-taxes",
      "sales-sales-orders",
      "sales-order-confirmation",
      "sales-availability-check",
      "sales-stock-reservation",
      "sales-delivery-shipment",
      "sales-sales-invoices",
      "accounting-customer-invoices",
      "accounting-customer-receipts",
      "accounting-payment-allocation",
    ],
    automatedActions: [
      "Duplicate detection on new leads, accounts, and contacts",
      "Tax calculation on quotations and orders",
      "Stock reservation for confirmed orders",
      "Double-entry enforcement when the receivable posts",
    ],
    approvals: [],
    exceptions: [
      "A likely duplicate lead, account, or contact is flagged instead of being created silently.",
      "An order line without available stock shows up at the availability check, before the order is promised.",
    ],
    visibility: [
      "The opportunity pipeline shows open deals by sales stage.",
      "Order status tracking shows where each order is between confirmation, delivery, and invoice.",
    ],
    businessValue: [
      "A qualified lead reaches an invoiced, paid order without re-typing the customer between CRM, Sales, and Accounting.",
      "Orders are promised against stock the warehouse actually has.",
      "Finance invoices and posts from the same order the sales team confirmed.",
    ],
    faqs: [
      { question: "Does the customer have to be re-entered between CRM and Sales?", answer: "No. An opportunity converts into a Sales quotation, so the customer and deal details carry through to the order and invoice." },
      { question: "Is stock checked before an order is confirmed?", answer: "Yes. The sales order's availability check shows what's available, and confirmed orders can reserve stock so the same units aren't promised twice." },
      { question: "How does the invoice reach the books?", answer: "The sales invoice becomes a customer invoice posted to receivables in the general ledger, and customer receipts are allocated against it." },
    ],
    screenshotId: "sales-quotation-detail",
  },
  {
    slug: "quote-to-order",
    name: "Quote to Order",
    modules: ["sales", "stock"],
    summary: "A quotation with discounts and taxes becomes a confirmed sales order, checked for availability and with stock reserved.",
    iaPriority: "P0",
  },
  {
    slug: "procure-to-pay",
    name: "Procure to Pay",
    modules: ["procurement", "stock", "accounting"],
    summary:
      "A purchase order is received against a goods receipt, the supplier invoice is matched to the order and receipt, and the matched invoice is posted and paid in Accounting.",
    iaPriority: "P0",
    directDefinition:
      "Procure to Pay is the purchasing sequence in Vercentlabs ERP, connecting Procurement, Inventory, and Accounting — a supplier invoice is checked against the purchase order and goods receipt before it's posted to payables and paid.",
    trigger: "The business needs to buy goods or services from a supplier.",
    participants: ["Buyer", "Supplier", "Receiving clerk", "Accounts payable"],
    sequence: [
      { step: "Supplier", moduleKey: "procurement", detail: "The supplier is set up with contacts, addresses, and payment terms." },
      { step: "Purchase order", moduleKey: "procurement", detail: "A purchase order is raised to the supplier with quantities and prices." },
      { step: "Goods receipt", moduleKey: "procurement", detail: "A goods receipt (GRN) records what arrived; rejected quantities are recorded as rejected receipts." },
      { step: "Stock", moduleKey: "stock", detail: "Received goods enter stock and post to the stock ledger." },
      { step: "Supplier invoice and matching", moduleKey: "procurement", detail: "The supplier invoice is matched 2-way against the purchase order, or 3-way against the order and the goods receipt." },
      { step: "Posting and payment", moduleKey: "accounting", detail: "The matched invoice posts to accounts payable, and the supplier payment is recorded and allocated." },
    ],
    capabilityIds: [
      "procurement-supplier-master",
      "procurement-supplier-contacts-addresses",
      "procurement-payment-terms",
      "procurement-purchase-orders",
      "procurement-goods-receipt",
      "procurement-rejected-receipts",
      "procurement-supplier-invoices",
      "procurement-two-way-matching",
      "procurement-three-way-matching",
      "stock-goods-receipts",
      "stock-stock-ledger",
      "accounting-supplier-invoices",
      "accounting-supplier-payments",
      "accounting-payment-allocation",
    ],
    automatedActions: ["2-way and 3-way invoice matching", "Stock ledger posting on goods receipt"],
    approvals: [],
    exceptions: [
      "Rejected quantities are recorded as rejected receipts, so they aren't treated as received stock.",
      "A supplier invoice that doesn't agree with the order and receipt shows up at matching, before it's paid.",
    ],
    visibility: [
      "Matching status shows which supplier invoices agree with their order and receipt.",
      "The stock ledger shows what each goods receipt brought in.",
    ],
    businessValue: [
      "You only pay for what was ordered and actually received.",
      "Purchasing, the warehouse, and accounts payable work from the same order and receipt.",
    ],
    faqs: [
      { question: "When should a purchase use 3-way matching instead of 2-way?", answer: "Use 3-way matching when goods are physically received — the invoice is checked against both the purchase order and the goods receipt. 2-way matching checks the invoice against the purchase order alone." },
      { question: "What happens to goods that are rejected on delivery?", answer: "They're recorded as rejected receipts against the purchase order, so they don't enter usable stock and aren't paid for as received." },
    ],
    screenshotId: "procurement-orders-list",
  },
  {
    slug: "order-to-fulfilment",
    name: "Order to Fulfilment",
    modules: ["stock", "sales"],
    summary:
      "Stock is received into warehouses, moved between them, reserved for confirmed orders, issued for delivery, and valued — all on one stock ledger.",
    iaPriority: "P0",
    directDefinition:
      "Order to Fulfilment is the inventory sequence in Vercentlabs ERP — receipts, internal transfers, reservations, and goods issues all post to one stock ledger, so balances, availability, and inventory valuation stay current while orders are fulfilled.",
    trigger: "Stock arrives in a warehouse, or a confirmed order needs to be fulfilled.",
    participants: ["Warehouse staff", "Inventory controller", "Order desk / sales operations"],
    sequence: [
      { step: "Receive", moduleKey: "stock", detail: "Goods receipts bring items into a warehouse and update the real-time stock balance." },
      { step: "Transfer", moduleKey: "stock", detail: "Internal transfers move stock between warehouses, with each movement in the inventory movement history." },
      { step: "Reserve", moduleKey: "sales", detail: "A confirmed sales order reserves available stock so it isn't promised twice." },
      { step: "Issue", moduleKey: "stock", detail: "A goods issue takes stock out for delivery; negative-stock control blocks issuing more than is available." },
      { step: "Value", moduleKey: "stock", detail: "Inventory valuation reflects every movement as it posts." },
    ],
    capabilityIds: [
      "stock-goods-receipts",
      "stock-real-time-stock-balance",
      "stock-internal-transfers",
      "stock-inventory-movement-history",
      "stock-stock-reservations",
      "stock-available-stock",
      "sales-stock-reservation",
      "stock-goods-issues",
      "stock-negative-stock-control",
      "stock-inventory-valuation",
      "stock-stock-ledger",
    ],
    automatedActions: ["Real-time balance update on every movement", "Negative-stock control", "Quality-hold movement blocking"],
    approvals: [],
    exceptions: [
      "An issue that would take stock below zero is blocked unless negative stock is explicitly allowed.",
      "Stock under a quality hold can't be moved until the hold is released.",
    ],
    visibility: [
      "Real-time stock balances show on-hand, reserved, and available stock by warehouse.",
      "The inventory movement history shows every receipt, transfer, issue, and adjustment.",
    ],
    businessValue: [
      "Orders are fulfilled from stock the system knows is really there.",
      "Inventory value is always current, not recalculated at month end.",
    ],
    faqs: [
      { question: "Can stock be reserved for an order before it ships?", answer: "Yes. Confirmed sales orders reserve stock, and available stock excludes what's already reserved." },
      { question: "Is inventory value updated as stock moves?", answer: "Yes. Inventory valuation reflects receipts, issues, transfers, and adjustments as they post to the stock ledger." },
    ],
    screenshotId: "stock-overview",
  },
  {
    slug: "plan-to-production",
    name: "Plan to Production",
    modules: ["manufacturing", "stock", "quality"],
    summary:
      "A manufacturing order is built from the bill of materials, materials are checked, issued, and consumed, output is inspected, and finished goods are received into stock with their production cost.",
    iaPriority: "P1",
    directDefinition:
      "Plan to Production is the production sequence in Vercentlabs ERP, connecting Manufacturing, Inventory, and Quality — a BOM-based manufacturing order checks and consumes materials, is inspected, and receives finished goods into stock.",
    trigger: "Finished goods need to be produced.",
    participants: ["Production planner", "Shop-floor supervisor", "Quality inspector", "Warehouse staff"],
    sequence: [
      { step: "BOM", moduleKey: "manufacturing", detail: "The item's bill of materials defines the components and quantities." },
      { step: "Manufacturing order", moduleKey: "manufacturing", detail: "A manufacturing order is created, and material availability is checked before work starts." },
      { step: "Material issue", moduleKey: "stock", detail: "Components are issued from stock to the order." },
      { step: "Consumption", moduleKey: "manufacturing", detail: "Material consumption and scrap are recorded against the order." },
      { step: "Inspection", moduleKey: "quality", detail: "Production quality inspections check the output; a production hold stops it if it fails." },
      { step: "Finished goods", moduleKey: "manufacturing", detail: "Finished goods are received into stock, and the order's production cost is recorded." },
    ],
    capabilityIds: [
      "manufacturing-bill-of-materials",
      "manufacturing-manufacturing-orders",
      "manufacturing-material-availability",
      "manufacturing-material-issue",
      "manufacturing-material-consumption",
      "manufacturing-scrap",
      "manufacturing-production-quality-inspections",
      "manufacturing-production-hold",
      "manufacturing-finished-goods-receipt",
      "manufacturing-production-costing",
      "stock-goods-issues",
    ],
    automatedActions: ["Material availability check", "Stock postings for material issue and finished-goods receipt"],
    approvals: [],
    exceptions: [
      "A material shortage shows up at the availability check, before production starts.",
      "Output that fails inspection is held instead of being received as good stock.",
    ],
    visibility: [
      "Each manufacturing order shows its materials, consumption, scrap, and inspection results.",
      "Production costing shows what each order cost.",
    ],
    businessValue: [
      "Production doesn't start without the materials to finish it.",
      "Every finished batch has its materials, inspection, and cost on record.",
    ],
    faqs: [
      { question: "Is scrap tracked against the manufacturing order?", answer: "Yes. Scrap is recorded alongside material consumption on the manufacturing order." },
      { question: "Can production output be held for quality?", answer: "Yes. Production quality inspections check output, and a production hold stops failed output from moving on." },
    ],
    screenshotId: "manufacturing-dashboard",
  },
  {
    slug: "inventory-to-replenishment",
    name: "Inventory to Replenishment",
    modules: ["stock", "procurement"],
    summary: "Real-time stock balances and available stock show buyers what's running low; they raise purchase orders to replenish, and goods receipts post the new stock back into the ledger.",
    iaPriority: "P1",
  },
  {
    slug: "project-to-profitability",
    name: "Project to Delivery",
    modules: ["projects", "hr-payroll"],
    summary:
      "A project is set up with milestones, tasks are assigned and prioritised, team members log timesheets, and progress is tracked through to delivery.",
    iaPriority: "P1",
    directDefinition:
      "Project to Delivery is the project sequence in Vercentlabs ERP — projects, milestones, and tasks with assignees and priorities, timesheets logged against the work, comments in context, and progress tracked through to delivery.",
    trigger: "A new project is started.",
    participants: ["Project manager", "Team members", "Operations lead"],
    sequence: [
      { step: "Set up", moduleKey: "projects", detail: "The project is created with its milestones and status." },
      { step: "Plan", moduleKey: "projects", detail: "Tasks are created, assigned, and prioritised." },
      { step: "Log time", moduleKey: "projects", detail: "Team members log timesheets against the project and task." },
      { step: "Collaborate", moduleKey: "projects", detail: "Comments keep discussion attached to the project and task." },
      { step: "Track", moduleKey: "projects", detail: "Project status and progress tracking show how delivery is going against the milestones." },
    ],
    capabilityIds: [
      "projects-projects",
      "projects-milestones",
      "projects-project-status",
      "projects-tasks",
      "projects-assignees",
      "projects-priority",
      "projects-timesheets",
      "projects-comments-collaboration",
      "projects-progress-tracking",
    ],
    automatedActions: ["Progress tracking from task and milestone status"],
    approvals: [],
    exceptions: ["A task without an assignee or priority stands out in the project's task list before it's forgotten."],
    visibility: ["Project status and progress across projects and milestones.", "Timesheets by project and task."],
    businessValue: [
      "Everyone works from one view of what's due, who owns it, and how far along it is.",
      "Time is recorded against the work it was spent on.",
    ],
    faqs: [
      { question: "Can milestones be tracked separately from tasks?", answer: "Yes. Milestones mark progress through a project, and progress tracking reflects both tasks and milestones." },
      { question: "Can team members comment on tasks?", answer: "Yes. Comments and collaboration keep discussion attached to the project and task it's about." },
    ],
    screenshotId: "projects-dashboard",
  },
  {
    slug: "hire-to-payroll",
    name: "Employee to Payroll",
    modules: ["hr-payroll"],
    summary:
      "An employee joins, works shifts with recorded attendance, requests and takes approved leave, and is paid through a calculated, approved payroll with a payslip.",
    iaPriority: "P0",
    directDefinition:
      "Employee to Payroll is the people sequence in Vercentlabs ERP — employee records, shifts and attendance, approved leave, and salary structures feed a payroll calculated for each period, approved, and issued as payslips.",
    trigger: "A new employee joins, or a payroll period comes to a close.",
    participants: ["HR admin", "Line manager", "Employee", "Payroll preparer", "Payroll approver"],
    sequence: [
      { step: "Employee", moduleKey: "hr-payroll", detail: "The employee record is created with department, designation, reporting manager, branch, and joining details." },
      { step: "Attendance", moduleKey: "hr-payroll", detail: "Attendance and check-in/check-out are recorded against the employee's shift." },
      { step: "Leave", moduleKey: "hr-payroll", detail: "Leave requests are approved, and leave balances update." },
      { step: "Payroll", moduleKey: "hr-payroll", detail: "Payroll is calculated for the period from the employee's salary structure, attendance, and leave, then approved." },
      { step: "Payslip", moduleKey: "hr-payroll", detail: "A payslip is issued for the approved payroll." },
    ],
    capabilityIds: [
      "hr-employee-master",
      "hr-joining",
      "hr-shifts",
      "hr-attendance",
      "hr-check-in-check-out",
      "hr-leave-requests",
      "hr-leave-approval",
      "hr-leave-balances",
      "hr-salary-structures",
      "hr-compensation-assignment",
      "hr-payroll-periods",
      "hr-payroll-calculation",
      "hr-payroll-approval",
      "hr-payslips",
    ],
    automatedActions: ["Payroll calculation from salary structures, attendance, and leave", "Leave-balance update on approval"],
    approvals: ["Leave requests are approved in the system.", "Payroll is approved before payslips are issued — an approver can't approve a payroll that includes their own pay."],
    exceptions: ["An approver whose own pay is in the payroll is blocked from approving it."],
    visibility: ["Payroll status and totals for each payroll period.", "Leave balances per employee."],
    businessValue: [
      "Payroll comes from the attendance and leave already recorded, not a monthly spreadsheet.",
      "Every payroll has an approval step before payslips go out.",
    ],
    faqs: [
      { question: "Does approved leave affect payroll?", answer: "Yes. Approved leave updates the leave balance, and payroll is calculated from the employee's attendance and leave for the period." },
      { question: "Who can approve a payroll?", answer: "Anyone with payroll-approval permission — except that an approver can't approve a payroll that includes their own pay." },
    ],
    screenshotId: "hr-payroll-dashboard",
  },
  {
    slug: "retail-checkout-to-inventory",
    name: "Retail Checkout to Inventory",
    modules: ["point-of-sale", "stock"],
    summary: "A POS sale is paid by cash, card, or UPI, reduces stock in real time, and is reconciled at shift close in the Day-End / Z report.",
    iaPriority: "P2",
  },
  {
    slug: "physical-goods-quality-gate",
    name: "Physical Goods Quality Gate",
    modules: ["quality", "procurement", "manufacturing", "stock"],
    summary:
      "Incoming, in-process, and final inspections record pass/fail results; a failure raises a non-conformance report and a quality hold that blocks the stock until it's released and dispositioned.",
    iaPriority: "P2",
  },
  {
    slug: "asset-acquisition-to-disposal",
    name: "Asset Acquisition to Disposal",
    modules: ["assets", "accounting"],
    summary:
      "An asset is capitalized, assigned to a custodian at a location, transferred and maintained on record, depreciated on a straight-line schedule, and disposed of with a full history.",
    iaPriority: "P2",
  },
  {
    slug: "support-ticket-resolution",
    name: "Support Ticket Resolution",
    modules: ["support", "crm"],
    summary:
      "A customer issue becomes a numbered ticket, is categorised, prioritised, and assigned, and is worked through replies and private notes to a resolved status — with its history kept and reopening possible.",
    iaPriority: "P2",
  },
  {
    slug: "returns-and-reverse-logistics",
    name: "Returns and Refunds",
    modules: ["sales", "point-of-sale", "stock"],
    summary: "Sales credit notes and refunds, and point-of-sale returns and refunds, correct the original transaction and the stock it affected.",
    iaPriority: "P2",
  },
  {
    slug: "tenant-onboarding-and-entitlement",
    name: "Tenant Onboarding & Module Access",
    modules: ["crm", "sales", "accounting", "procurement", "stock", "manufacturing", "projects", "assets", "point-of-sale", "quality", "support", "hr-payroll"],
    summary:
      "An organisation and its companies are set up, users are invited and given roles, and modules are enabled or disabled per organisation within its subscription plan.",
    iaPriority: "P2",
  },
]);

/** Slugs of the 6 workflows with a real /workflows/{slug} page. */
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

/**
 * The module handoff path of a routed workflow: its steps grouped into
 * consecutive runs by owning module, so CRM, CRM, Sales becomes
 * CRM (Lead, Opportunity) then Sales (Quotation). Derived from the sequence,
 * never typed separately.
 */
export function getWorkflowModulePath(slug) {
  const sequence = getWorkflow(slug)?.sequence ?? [];
  const path = [];
  for (const step of sequence) {
    const last = path[path.length - 1];
    if (last && last.moduleKey === step.moduleKey) last.steps.push(step.step);
    else path.push({ moduleKey: step.moduleKey, steps: [step.step] });
  }
  return path;
}

/**
 * The approved launch capabilities a routed workflow relies on, grouped by the
 * module (or Shared Platform) that owns them, in the order the modules first
 * appear in the workflow. Names come from the capability register.
 */
export function getWorkflowCapabilityGroups(slug) {
  const workflow = getWorkflow(slug);
  if (!workflow?.capabilityIds) return [];
  const order = [...new Set((workflow.sequence ?? []).map((step) => step.moduleKey))];
  const groups = new Map();
  for (const id of workflow.capabilityIds) {
    const capability = getLaunchCapability(id);
    if (!capability) throw new Error(`Workflow "${slug}" references unknown launch capability "${id}".`);
    if (!groups.has(capability.moduleKey)) groups.set(capability.moduleKey, []);
    groups.get(capability.moduleKey).push(capability.name);
  }
  const rank = (key) => (order.includes(key) ? order.indexOf(key) : order.length);
  return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b)).map(([ownerKey, capabilities]) => ({ ownerKey, capabilities }));
}

/** /workflows — the index of cross-module workflows. */
export const WORKFLOWS_INDEX_PAGE = Object.freeze({
  slug: "/workflows",
  title: "Cross-Module Workflows",
  metaDescription:
    "See how work moves across Vercentlabs ERP: lead to cash, procure to pay, order to fulfilment, plan to production, project delivery and employee to payroll, step by step across modules.",
  eyebrow: "Connected workflows",
  heading: "See how work moves across the ERP.",
  supportingText:
    "Each workflow shows the steps of a business process, the module that owns each step, and where the record is handed on to the next module. Every step is an approved launch capability.",
  listHeading: "Business processes, step by step.",
  singleModuleHeading: "Processes inside one module.",
  singleModuleSupportingText: "These run end to end within a single module, so there is no module handoff to show.",
  finalCta: {
    heading: "Follow a process through the modules that run it.",
    supportingText: "Open a workflow for the full step sequence, the capabilities it relies on, and the modules involved.",
  },
});


/** Section copy shared by every /workflows/[slug] page. */
export const WORKFLOW_DETAIL_PAGE = Object.freeze({
  eyebrow: "Workflow",
  triggerLabel: "Starts when",
  scopeLabel: (steps, modules) => `${steps} steps across ${modules} ${modules === 1 ? "module" : "modules"}`,
  finalHeading: (name) => `${name}, walked through for your business.`,
  allWorkflowsLabel: "All workflows",
  sequenceEyebrow: "The full sequence",
  sequenceHeading: "Every step, and the module that owns it.",
  capabilitiesEyebrow: "Capabilities used",
  capabilitiesHeading: "The approved capabilities this workflow relies on.",
  capabilitiesSupportingText: "Grouped by the module that provides them. Each one is part of the approved launch scope.",
  evidenceEyebrow: "Product evidence",
  evidenceHeading: "Screens from this workflow.",
  modulesEyebrow: "Modules involved",
  modulesHeading: "The modules this workflow runs through.",
  relatedEyebrow: "Related workflows",
  faqEyebrow: "Buyer questions",
  faqHeading: "Questions buyers ask about this workflow.",
});

/**
 * Routed workflows whose sequence includes a module, most relevant first: by
 * the share of steps that module owns, then in ROUTED_WORKFLOW_SLUGS order.
 */
export function getRoutedWorkflowsForModule(moduleKey) {
  return getRoutedWorkflows()
    .filter((workflow) => (workflow.sequence ?? []).some((step) => step.moduleKey === moduleKey))
    .map((workflow, index) => ({ workflow, index, share: workflow.sequence.filter((step) => step.moduleKey === moduleKey).length / workflow.sequence.length }))
    .sort((a, b) => b.share - a.share || a.index - b.index)
    .map(({ workflow }) => workflow);
}
