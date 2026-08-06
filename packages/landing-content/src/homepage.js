/**
 * Typed homepage content model — the single source of truth apps/landing's
 * homepage composes from. See docs/landing-redesign/phase-3/
 * homepage-content-specification.md for the rationale behind every section.
 *
 * Every capability claim here traces to docs/landing-redesign/phase-1/
 * product-intelligence.md. Where that document's "Honest Limitations" section
 * flags something as NOT automated (e.g. a standard sales order does not yet
 * trigger an automatic stock deduction — only Manufacturing and POS post real
 * stock movements today), the copy below is written to avoid implying it is.
 */

export const HOMEPAGE_METADATA = Object.freeze({
  title: "Vercentlabs ERP — The ERP for Businesses That Outgrew Spreadsheets",
  // Kept to ~150 characters so the CTA survives real SERP truncation
  // (~155-160 chars) — see docs/landing-redesign/phase-3/decision-log.md.
  description:
    "Vercentlabs connects sales, inventory, procurement, production, and finance on one live system — for manufacturers and distributors. Book a demo.",
  /** Sitemap lastModified is sourced from here, not build time — see sitemap.ts. */
  lastReviewed: "2026-08-06",
});

export const HERO = Object.freeze({
  id: "hero",
  eyebrow: "Connected ERP for manufacturers and distributors",
  heading: "The ERP for businesses that outgrew spreadsheets.",
  supportingText:
    "Vercentlabs connects sales, inventory, procurement, production, finance, employees, projects, and service on one live system — so the number your warehouse sees is the same one your finance team sees.",
  primaryCta: { label: "Book a Product Demo", href: "/book-demo", analyticsId: "hero_primary_cta_click" },
  secondaryCta: { label: "Explore the Platform", href: "/product/platform", analyticsId: "hero_secondary_cta_click" },
  evidence: [
    { label: "Connected modules", value: "12" },
    { label: "Implemented capabilities", value: "1,039" },
    { label: "Operating model", value: "Multi-company" },
    { label: "Access model", value: "Role-based" },
  ],
  screenshotId: "crm-pipeline-board",
  analyticsId: "hero_view",
});

export const PROBLEM_SECTION = Object.freeze({
  id: "problem",
  eyebrow: "The cost of disconnected tools",
  heading: "Growth exposes the seams between systems that were never meant to talk to each other.",
  supportingText:
    "A spreadsheet next to an accounting tool next to a WhatsApp thread works for a while. Then a stock count doesn't match, an approval sits in someone's inbox for a week, and nobody can say who approved the last price override.",
  items: [
    { title: "Duplicate data", description: "The same customer, item, or supplier is re-typed into three different tools — and drifts out of sync between them." },
    { title: "Manual reconciliation", description: "Someone spends a day a month matching what the spreadsheet says against what the accounting system says." },
    { title: "Delayed approvals", description: "A discount, a purchase order, or a leave request waits on an email thread instead of a governed workflow." },
    { title: "Inventory uncertainty", description: "What's actually in stock is a guess until someone walks the warehouse and counts it by hand." },
    { title: "Inconsistent reporting", description: "Sales, finance, and operations each keep their own version of the numbers — and the three don't agree." },
    { title: "Weak process ownership", description: "When a handoff breaks, there's no record of where — or whose job it was to catch it." },
    { title: "Departmental silos", description: "Procurement doesn't know what sales just promised a customer; production doesn't know what procurement just ordered." },
    { title: "Limited auditability", description: "When something goes wrong, reconstructing who changed what — and when — takes hours, if it's possible at all." },
  ],
  analyticsId: "problem_section_view",
});

export const CONNECTED_SYSTEM_SECTION = Object.freeze({
  id: "connected-system",
  eyebrow: "Why this is an ERP, not five apps with one login",
  heading: "One record moves through the business — not five copies of it.",
  supportingText:
    "A lead becomes an opportunity, a quotation, and an order without being re-typed. The same order is visible to finance for invoicing and to the warehouse and production teams who need to know it exists — on the same system, not synced between separate ones.",
  steps: [
    { label: "Lead", module: "crm", detail: "Captured from any channel, scored, and assigned automatically." },
    { label: "Opportunity", module: "crm", detail: "Progresses through a governed pipeline with qualification checkpoints." },
    { label: "Quotation", module: "sales", detail: "Priced with GST-aware tax rules, accepted publicly with a digital signature." },
    { label: "Sales order", module: "sales", detail: "Converted from the accepted quotation with a real-time credit check." },
    { label: "Warehouse & production", module: "stock", detail: "See the same order and item records — no separate spreadsheet to reconcile." },
    { label: "Quality", module: "quality", detail: "Inspects incoming, in-process, and outgoing goods against the same item and batch records." },
    { label: "Invoice", module: "accounting", detail: "Generated from the order through an auditable, idempotent handoff." },
    { label: "Support", module: "support", detail: "Any resulting ticket carries the full order and account history automatically." },
  ],
  analyticsId: "workflow_view",
});

export const MODULE_ARCHITECTURE_SECTION = Object.freeze({
  id: "modules",
  eyebrow: "Twelve modules, one system of record",
  heading: "Every operational function your business runs, connected by default.",
  supportingText: "Grouped the way your teams actually think about the business — not by internal engineering structure.",
  groupSummaries: [
    { groupKey: "revenue", outcome: "From first contact to the till — one pipeline, one price book, one order history." },
    { groupKey: "operations", outcome: "What you can build, buy, and ship — governed by the same supplier and item records." },
    { groupKey: "finance", outcome: "The books and the assets that back them, reconciled against real transactions, not estimates." },
    { groupKey: "people-and-service", outcome: "The people running the business, and the customers they serve after the sale." },
    { groupKey: "delivery", outcome: "Billable work, tracked against budget and margin while it's still in progress." },
  ],
  analyticsId: "module_group_view",
});

export const BREADTH_SECTION = Object.freeze({
  id: "breadth",
  eyebrow: "Depth without the feature dump",
  heading: "1,039 implemented capabilities, organised around the workflows your teams use every day.",
  supportingText:
    "Not a roadmap — a working system. The count is large because a real ERP has to cover a lot of ground; here's how it breaks down.",
  breakdown: [
    { label: "Operational modules", value: "945", description: "Capabilities specific to the 12 modules above — from lead scoring to production costing." },
    { label: "Shared platform", value: "94", description: "Multi-tenancy, roles and permissions, approvals, audit, reporting, and mobile access — used by every module." },
    { label: "Governed automation", value: "Built in", description: "Approval routing, separation-of-duties enforcement, and SLA tracking, not bolted on after the fact." },
    { label: "Audit trail", value: "Immutable", description: "Every record change is logged at the database level — even an application bug can't alter history." },
  ],
  analyticsId: "breadth_section_view",
});

export const FLAGSHIP_WORKFLOW_SECTION = Object.freeze({
  id: "flagship-workflow",
  eyebrow: "See it work: lead to cash",
  heading: "From a captured lead to a posted invoice — without leaving the system once.",
  supportingText:
    "This is the same sequence a real deal follows inside Vercentlabs, not a simplified diagram of how ERPs work in general.",
  workflowSlug: "lead-to-cash",
  screenshotIds: ["crm-pipeline-board", "sales-quotation-detail", "sales-order-detail"],
  steps: [
    { step: "Lead captured", department: "Marketing / Sales", systemAction: "Scored automatically and assigned by policy — no manual triage queue." },
    { step: "Converted to opportunity", department: "Sales", systemAction: "Account and contact records created in one step; duplicate accounts are flagged, not silently created." },
    { step: "Quotation issued", department: "Sales", systemAction: "Priced against the customer's price list and India GST rules automatically." },
    { step: "Customer accepts", department: "Customer", systemAction: "Approves publicly with a typed signature — no separate e-signature tool." },
    { step: "Order confirmed", department: "Sales / Finance", systemAction: "Checked against the customer's live credit exposure before confirmation is allowed." },
    { step: "Invoice posted", department: "Finance", systemAction: "Generated from the order through an idempotent, auditable handoff — not re-keyed." },
  ],
  analyticsId: "workflow_interaction",
});

export const ROLE_VALUE_SECTION = Object.freeze({
  id: "role-value",
  eyebrow: "One system, every seat",
  heading: "The same connected data means something different to every role.",
  roles: [
    { role: "Owners & executives", gains: "One real number for revenue, stock, and cash — not three reports that disagree." },
    { role: "Sales teams", gains: "A pipeline that reflects what's actually been quoted and ordered, not what's remembered." },
    { role: "Operations teams", gains: "Shared item and order records with production and the warehouse — no separate spreadsheet to keep in sync." },
    { role: "Finance teams", gains: "Invoices generated from real orders, a governed close process, and an audit trail that holds up." },
    { role: "Manufacturing teams", gains: "A work order that can't be released without the components to build it." },
    { role: "HR & people teams", gains: "Attendance-driven payroll with the same separation-of-duties controls as the rest of the business." },
  ],
  analyticsId: "role_value_view",
});

export const AUTOMATION_SECTION = Object.freeze({
  id: "automation",
  eyebrow: "Automation and reporting, not an add-on",
  heading: "Governed automation that enforces how work is actually supposed to happen.",
  items: [
    { title: "Approval routing", description: "Discounts, purchase orders, and journal entries route to the right approver by policy, not by whoever's free." },
    { title: "Separation of duties", description: "The person who creates a record can't approve it — enforced in the system, not just written in a policy document." },
    { title: "SLA and escalation", description: "Support tickets carry policy-driven due dates and escalate automatically when they're missed." },
    { title: "Quality holds", description: "A failed inspection places an automatic hold on the affected stock — no manual flag to remember." },
    { title: "Cross-module reporting", description: "Dashboards read from the same live data every module writes to, not a separate reporting warehouse that's a day behind." },
  ],
  analyticsId: "automation_section_view",
});

export const SECURITY_SECTION = Object.freeze({
  id: "security",
  eyebrow: "Enterprise control, explained plainly",
  heading: "The controls a buying committee actually asks about.",
  supportingText: "Real, implemented mechanisms — not a generic security-policy page.",
  items: [
    { title: "Role-based access", description: "Twelve seeded system roles with hand-curated permission sets, scoped to what each role actually needs." },
    { title: "Time-bound & scoped roles", description: "Access can expire automatically and be scoped to a specific company, branch, or department — not all-or-nothing." },
    { title: "Approval workflows", description: "A reusable, governed command registry enforces maker-checker approval across accounting, sales, CRM, HR, assets, and projects." },
    { title: "Immutable audit trail", description: "A database trigger rejects any attempt to alter or delete an audit log entry — even from inside the application." },
    { title: "Multi-company data isolation", description: "Structural, database-level isolation between companies and branches — not just an application-layer filter." },
    { title: "Tenant isolation", description: "Every tenant's data is isolated at the database layer, enforced on every query, not assumed by convention." },
  ],
  analyticsId: "security_section_view",
});

export const IMPLEMENTATION_SECTION = Object.freeze({
  id: "implementation",
  eyebrow: "Getting live",
  heading: "A configurable product still needs a structured rollout — here's what that actually looks like.",
  supportingText:
    "Vercentlabs is configurable, not a black box — but a real ERP adoption succeeds or fails on the implementation, not the software alone.",
  steps: [
    { step: "01", title: "Discovery", description: "We map your current processes, data, and the modules you actually need on day one." },
    { step: "02", title: "Configuration", description: "Roles, approval chains, numbering series, and module settings are configured to match how you work." },
    { step: "03", title: "Data migration", description: "Customers, items, suppliers, and open balances are migrated and reconciled before go-live." },
    { step: "04", title: "Validation", description: "Your team runs real transactions in a staging environment before anything goes live." },
    { step: "05", title: "Team training", description: "Role-specific training for the people who'll actually use the system day to day." },
    { step: "06", title: "Controlled launch", description: "A phased go-live, module by module or location by location — not a single high-risk cutover." },
    { step: "07", title: "Post-launch support", description: "Structured support during the weeks where real usage surfaces what training couldn't." },
  ],
  analyticsId: "implementation_section_view",
});

export const BUYER_QUESTIONS_SECTION = Object.freeze({
  id: "buyer-questions",
  eyebrow: "Straight answers",
  heading: "What buyers actually ask before booking a demo.",
  questions: [
    {
      question: "Can Vercentlabs support multiple companies or locations?",
      answer: "Yes. Multi-company and branch-level data isolation is implemented at the database layer, and role access can be scoped to a specific company or branch rather than granted organisation-wide.",
    },
    {
      question: "Can modules be adopted together, or one at a time?",
      answer: "Both. All 12 modules run on one shared platform and data model, but module access is entitlement-gated per organisation — you can enable what you need now and add more later.",
    },
    {
      question: "Can workflows and approvals be configured to match how we work?",
      answer: "Yes. Roles, permission sets, and approval routing are configured per organisation through a reusable governed command registry, not hard-coded.",
    },
    {
      question: "Can our existing business data be migrated in?",
      answer: "Yes — customers, items, suppliers, and open transactions are migrated and reconciled as part of implementation, not left for you to re-enter by hand.",
    },
    {
      question: "Is Vercentlabs suitable for manufacturing or distribution businesses specifically?",
      answer: "Yes. The Manufacturing module covers bills of materials, work orders, and production posting into a live stock ledger; the Stock and Point of Sale modules cover multi-location distribution and retail.",
    },
    {
      question: "How is access controlled?",
      answer: "Through role-based permissions with optional time-bound expiry and company/branch/department scoping, backed by an immutable, database-enforced audit trail of every change.",
    },
  ],
  analyticsId: "buyer_questions_view",
});

export const FINAL_CTA_SECTION = Object.freeze({
  id: "final-cta",
  heading: "See how your operations would run in one connected system.",
  supportingText: "The demo is adapted to your business — the modules and workflows you'd actually use, not a generic tour.",
  primaryCta: { label: "Book a Product Demo", href: "/book-demo", analyticsId: "final_cta_click" },
  analyticsId: "final_cta_view",
});

/** Ordered list of homepage sections — apps/landing/app/page.tsx renders exactly this sequence. */
export const HOMEPAGE_SECTIONS = Object.freeze([
  HERO,
  PROBLEM_SECTION,
  CONNECTED_SYSTEM_SECTION,
  MODULE_ARCHITECTURE_SECTION,
  BREADTH_SECTION,
  FLAGSHIP_WORKFLOW_SECTION,
  ROLE_VALUE_SECTION,
  AUTOMATION_SECTION,
  SECURITY_SECTION,
  IMPLEMENTATION_SECTION,
  BUYER_QUESTIONS_SECTION,
  FINAL_CTA_SECTION,
]);
