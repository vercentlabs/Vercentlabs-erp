import {
  LAUNCH_BUSINESS_MODULE_COUNT,
  LAUNCH_CAPABILITY_COUNTS,
  LAUNCH_CAPABILITY_TOTAL,
  SHARED_PLATFORM_KEY,
  launchCapabilityNames,
} from "./capabilities/launch-capabilities.js";
import { LANDING_MODULES } from "./modules/index.js";
import { POSITIONING, SITE_IDENTITY } from "./metadata.js";
import { CTAS, MODULE_NAV_GROUPS } from "./navigation.js";

/**
 * Typed homepage content model — the single source of truth apps/landing's
 * homepage composes from.
 *
 * The story runs: what it is (hero) → what it connects (the connected-ERP
 * map) → why that matters (fragmentation) → how work moves (workflows) →
 * what is included (modules) → what sits underneath (Shared Platform) → what
 * it means for each team → how broad it is (the approved launch scope as
 * proof) → how to evaluate it → how adoption works → whether it can be
 * trusted → buyer questions → the next step. The capability count is proof,
 * never the headline.
 *
 * Product claims must stay inside the approved launch capability register
 * (capabilities/launch-capabilities.js); every product-breadth number and
 * capability name is derived from it, and CTAs come from the CTAS contract in
 * navigation.js.
 */

const PLATFORM_CAPABILITY_COUNT = LAUNCH_CAPABILITY_COUNTS[SHARED_PLATFORM_KEY];
const MODULE_CAPABILITY_COUNT = LAUNCH_CAPABILITY_TOTAL - PLATFORM_CAPABILITY_COUNT;

export const HOMEPAGE_METADATA = Object.freeze({
  // Rendered as-is: the root segment doesn't receive the "| Vercentlabs ERP" title template.
  title: `${SITE_IDENTITY.productName} — One ERP for Your Entire Business`,
  // Kept near ~150 characters so it survives SERP truncation.
  description: `${POSITIONING.masterPromise} ${SITE_IDENTITY.productName} connects ${LAUNCH_BUSINESS_MODULE_COUNT} business modules — CRM, sales, inventory, HR, accounting and more — on one platform.`,
});

export const HERO = Object.freeze({
  id: "hero",
  eyebrow: SITE_IDENTITY.productName,
  heading: POSITIONING.heroHeadline,
  supportingText:
    "Connect CRM, sales, procurement, inventory, manufacturing, projects, assets, POS, quality, support, HR & payroll, and finance in one ERP — so every team works from the same connected business data.",
  primaryCta: { ...CTAS.primary, analyticsId: "hero_primary_cta_click" },
  secondaryCta: { ...CTAS.talkToSpecialist, analyticsId: "hero_secondary_cta_click" },
  evidence: [
    { value: String(LAUNCH_BUSINESS_MODULE_COUNT), label: "business modules" },
    { value: String(LAUNCH_CAPABILITY_TOTAL), label: "approved MVP capabilities" },
    { value: "1", label: "shared platform" },
  ],
  // Shown only once an approved, current capture exists; until then the hero
  // renders the connected-ERP map instead (apps/landing lib/product/screenshots.ts).
  screenshotId: "crm-pipeline-board",
  analyticsId: "hero_view",
});

export const CONNECTED_ERP_SECTION = Object.freeze({
  id: "connected-erp",
  eyebrow: "One connected ERP",
  heading: "Your business functions should not behave like separate systems.",
  supportingText:
    "Every module runs on one ERP core and one Shared Platform. Each team works in the module built for its part of the business, and the records it creates carry on to the next team.",
  layers: [
    { key: "modules", label: `${LAUNCH_BUSINESS_MODULE_COUNT} business modules`, description: "Each team works in the module built for its part of the business — from CRM to Accounting." },
    { key: "core", label: "One ERP core", description: "Customers, items, orders, and postings are shared records, handed on between modules instead of copied." },
    { key: "platform", label: "One Shared Platform", description: "Access, audit, data integrity, and settings sit underneath every module." },
  ],
  mapCaption: `${LAUNCH_BUSINESS_MODULE_COUNT} business modules on one ERP core and one Shared Platform.`,
  // The route traced by the map's motion — a real, routed workflow.
  route: { workflowSlug: "lead-to-cash", label: "Lead to Cash", moduleKeys: ["crm", "sales", "stock", "accounting"] },
  analyticsId: "connected_erp_view",
});

export const PROBLEM_SECTION = Object.freeze({
  id: "problem",
  eyebrow: "The cost of disconnected systems",
  heading: POSITIONING.problemStatement,
  supportingText:
    "When sales, inventory, purchasing, people, and finance each run in a separate tool, the business pays for it in re-typed data, mismatched numbers, and handoffs nobody owns.",
  // Generic categories of tools, never named products.
  fragmented: {
    label: "Disconnected tools",
    systems: ["CRM", "Spreadsheets", "Inventory software", "Email", "Payroll tool", "Accounting system"],
    // One per handoff between consecutive tools.
    handoffs: ["Re-typed", "Exported", "Forwarded by email", "Re-keyed", "Matched by hand"],
  },
  connected: {
    label: "One ERP",
    summary: "One set of records, shared by every module.",
    moduleKeys: ["crm", "sales", "stock", "support", "hr-payroll", "accounting"],
  },
  items: [
    { title: "Repeated data entry", description: "The same customer, item, or supplier is typed into several tools — and the copies drift apart." },
    { title: "Disconnected records", description: "An order, its delivery, and its invoice live in different systems, so nobody sees the whole transaction." },
    { title: "Manual reconciliation", description: "Someone spends days each month matching what one system says against another." },
    { title: "Inconsistent information", description: "Sales, operations, and finance each keep their own version of the numbers — and they don't agree." },
    { title: "Weak handoffs", description: "Work passes between teams by email and chat, and details get lost on the way." },
    { title: "Poor visibility", description: "Stock, orders, and cash only become clear after someone pulls reports from several places." },
  ],
  analyticsId: "problem_section_view",
});

export const CONNECTED_WORKFLOWS_SECTION = Object.freeze({
  id: "connected-workflows",
  eyebrow: "Connected workflows",
  heading: "One workflow. Multiple modules. No broken handoffs.",
  supportingText:
    "Choose a process to see which module owns each step — and where the record crosses into the next one. Each team still does its own part of the work; the information carries through.",
  // Routed workflows only: each has a full /workflows/{slug} page and an
  // approved-capability sequence in workflows.js.
  workflowSlugs: ["lead-to-cash", "procure-to-pay", "plan-to-production", "order-to-fulfilment", "hire-to-payroll"],
  analyticsId: "workflow_view",
  interactionAnalyticsId: "workflow_interaction",
});

export const MODULE_ARCHITECTURE_SECTION = Object.freeze({
  id: "modules",
  eyebrow: "The modules",
  heading: `${LAUNCH_BUSINESS_MODULE_COUNT} business modules. One connected ERP.`,
  supportingText:
    "Every module runs on one Shared Platform and one data model — not separate apps behind a shared login — so you can start with what you need and add more without switching systems.",
  groupSummaries: [
    { groupKey: "revenue", outcome: "From first contact to the till — one pipeline, one customer record, one order history." },
    { groupKey: "operations", outcome: "What you buy, hold, make, and inspect — on the same supplier, item, and stock records." },
    { groupKey: "finance", outcome: "The books and the assets behind them, posted from real transactions." },
    { groupKey: "people-and-service", outcome: "The people running the business, and the customers they serve after the sale." },
    { groupKey: "delivery", outcome: "Projects, milestones, tasks, and timesheets — tracked through to delivery." },
  ],
  platform: {
    label: "Shared Platform",
    summary: "The foundation every module inherits — it isn't a separate product.",
    href: "/product/platform",
    highlights: launchCapabilityNames([
      "platform-authentication",
      "platform-user-management",
      "platform-roles",
      "platform-permissions",
      "platform-company-branch-access",
      "platform-notifications",
      "platform-audit-logs",
      "platform-import",
      "platform-export",
      "platform-transaction-safety",
      "platform-monitoring",
      "platform-responsive-ui",
      "platform-permission-aware-navigation",
    ]),
  },
  analyticsId: "module_group_view",
});

function platformFamily(key, title, description, capabilityIds) {
  return { key, title, description, capabilities: launchCapabilityNames(capabilityIds) };
}

export const PLATFORM_FOUNDATION_SECTION = Object.freeze({
  id: "platform",
  eyebrow: "Shared Platform",
  heading: "One platform underneath every module.",
  supportingText: `Every module inherits the same ${PLATFORM_CAPABILITY_COUNT} Shared Platform capabilities, so access, audit, and data integrity behave the same way in CRM as they do in Accounting.`,
  families: [
    platformFamily("access", "Access", "Who can sign in, and what each person can see and do.", [
      "platform-authentication",
      "platform-session-management",
      "platform-user-management",
      "platform-roles",
      "platform-permissions",
      "platform-record-level-access",
    ]),
    platformFamily("structure", "Business structure", "Tenants, companies, and branches — and the settings each one runs with.", [
      "platform-tenant-management",
      "platform-company-management",
      "platform-company-branch-access",
      "platform-company-settings",
      "platform-module-enable-disable",
    ]),
    platformFamily("integrity", "Data integrity", "Every save is checked, and every posting completes fully or not at all.", [
      "platform-validation",
      "platform-transaction-safety",
      "platform-idempotency",
      "platform-concurrency-protection",
      "platform-error-handling",
    ]),
    platformFamily("traceability", "Traceability", "What happened to a record, who did it, and the context around it.", [
      "platform-audit-logs",
      "platform-activity-history",
      "platform-comments",
      "platform-attachments",
      "platform-notifications",
    ]),
    platformFamily("operations", "Operations", "The running system — backed up, logged, and monitored.", [
      "platform-backups",
      "platform-restore-process",
      "platform-logging",
      "platform-monitoring",
      "platform-health-checks",
    ]),
    platformFamily("experience", "Experience", "Finding and moving data, on any screen size.", [
      "platform-search",
      "platform-filtering",
      "platform-import",
      "platform-export",
      "platform-responsive-ui",
      "platform-permission-aware-navigation",
    ]),
  ],
  analyticsId: "platform_section_view",
});

export const ROLE_VALUE_SECTION = Object.freeze({
  id: "role-value",
  eyebrow: "One system, every team",
  heading: "The same connected data, working for every part of the business.",
  roles: [
    { role: "Owners & executives", gains: "One set of numbers for sales, stock, and the books — instead of reports that disagree.", moduleKeys: ["sales", "stock", "accounting"] },
    { role: "Sales teams", gains: "Leads, opportunities, quotations, and orders in one place, with stock availability checked before an order is confirmed.", moduleKeys: ["crm", "sales"] },
    { role: "Operations teams", gains: "Purchasing, inventory, production, and quality working from the same supplier, item, and stock records.", moduleKeys: ["procurement", "stock", "manufacturing", "quality"] },
    { role: "Finance teams", gains: "Invoices from real orders, reconciled bank accounts, and financial statements straight from the ledger.", moduleKeys: ["accounting", "sales"] },
    { role: "People & HR teams", gains: "Employee records, attendance, leave, and payroll in one place, with payroll approved before payslips are issued.", moduleKeys: ["hr-payroll"] },
    { role: "Customer & service teams", gains: "Support tickets logged against the same customers and contacts the sales team works with.", moduleKeys: ["support", "crm"] },
  ],
  analyticsId: "role_value_view",
});

export const BREADTH_SECTION = Object.freeze({
  id: "breadth",
  eyebrow: "The launch scope",
  heading: `${LAUNCH_CAPABILITY_TOTAL} approved MVP capabilities.`,
  supportingText:
    "The approved launch scope of Vercentlabs ERP, organised around how the business runs: the capabilities each business module launches with, plus the Shared Platform every module runs on.",
  // Derived per owner from the register, in module-group order, Shared Platform last.
  distribution: [
    ...MODULE_NAV_GROUPS.flatMap((group) => group.moduleKeys).map((key) => ({
      key,
      label: LANDING_MODULES.find((landingModule) => landingModule.key === key).displayName,
      count: LAUNCH_CAPABILITY_COUNTS[key],
    })),
    { key: SHARED_PLATFORM_KEY, label: "Shared Platform", count: PLATFORM_CAPABILITY_COUNT },
  ],
  breakdown: [
    { label: "Business module capabilities", value: String(MODULE_CAPABILITY_COUNT), description: `Across ${LAUNCH_BUSINESS_MODULE_COUNT} business modules.` },
    { label: "Shared Platform capabilities", value: String(PLATFORM_CAPABILITY_COUNT), description: "Inherited by every module." },
  ],
  cta: { label: "See what each module includes", href: "/modules" },
  analyticsId: "breadth_section_view",
});

export const EVALUATION_SECTION = Object.freeze({
  id: "evaluate",
  eyebrow: "Evaluate on your terms",
  heading: "Explore before you talk to sales.",
  supportingText:
    "The product, module, and workflow pages describe the approved launch scope in full. Work through them at your own pace, and bring in a specialist when you want a walkthrough of your own processes.",
  // Ordered evaluation paths. Add a path here (for example a self-serve
  // trial, once it exists) rather than changing the homepage layout.
  paths: [
    {
      key: "explore",
      title: "Explore on your own",
      description: "Browse the product, module, and platform pages to see what each part of the ERP covers.",
      cta: { ...CTAS.primary },
    },
    {
      key: "workflow",
      title: "Follow a workflow",
      description: "See how a process such as Lead to Cash or Procure to Pay moves across modules, step by step.",
      cta: { label: "Browse workflows", href: "/workflows" },
    },
    {
      key: "specialist",
      title: "Get a guided walkthrough",
      description: "Talk through your own business and the modules you would start with, with an assisted walkthrough.",
      cta: { ...CTAS.talkToSpecialist },
    },
  ],
  analyticsId: "evaluation_section_view",
  pathAnalyticsId: "evaluation_path_click",
});

export const IMPLEMENTATION_SECTION = Object.freeze({
  id: "implementation",
  eyebrow: "Getting live",
  heading: "A typical path from evaluation to go-live.",
  supportingText: "Most rollouts follow the same broad steps. The detail depends on your business and the modules you start with.",
  steps: [
    { step: "01", title: "Understand", description: "Map how the business runs today and decide which modules to start with." },
    { step: "02", title: "Configure", description: "Set up companies, roles and permissions, document numbering, and module settings." },
    { step: "03", title: "Prepare data", description: "Bring in the customers, items, suppliers, and opening balances you need to start." },
    { step: "04", title: "Validate", description: "Run real transactions through the configured system before relying on it." },
    { step: "05", title: "Train", description: "Show each team how their part of the work runs in the system." },
    { step: "06", title: "Go live", description: "Start using it for day-to-day work — all at once or module by module." },
  ],
  analyticsId: "implementation_section_view",
});

export const SECURITY_SECTION = Object.freeze({
  id: "security",
  eyebrow: "Trust & security",
  heading: "Control access. Keep actions traceable.",
  supportingText: "Controls from the Shared Platform, described plainly — what they do and where they're enforced.",
  accessChain: [
    { label: "User", detail: "Signs in to a managed session." },
    { label: "Role", detail: "Grants a defined set of permissions." },
    { label: "Permission", detail: "Checked on the server for every action." },
    { label: "Record", detail: "Narrowed by record, company, and branch access." },
  ],
  traceChain: [
    { label: "Action", detail: "A significant change is made." },
    { label: "Audit event", detail: "Written to an audit log the database protects from edits and deletion." },
    { label: "History", detail: "Kept with the record, so changes can be traced back." },
  ],
  items: [
    { title: "Tenant isolation", description: "Each organisation's data is isolated in the database by row-level security on its tenant tables." },
    { title: "Roles and permissions", description: "What each person can see and do is set by their role's permissions and checked on the server, not just hidden in the interface." },
    { title: "Record-level access", description: "Access can be limited to the records a person is responsible for, not just whole modules." },
    { title: "Company and branch access", description: "Access can be scoped by company and branch through permissions and query-level controls in the application." },
    { title: "Protected audit log", description: "The platform audit log can't be edited or deleted — the database rejects any attempt to change it, even from inside the application." },
    { title: "Backups and restore", description: "Data is backed up, with a restore process." },
  ],
  cta: { label: "See the security architecture", href: "/security" },
  analyticsId: "security_section_view",
});

export const BUYER_QUESTIONS_SECTION = Object.freeze({
  id: "buyer-questions",
  eyebrow: "Straight answers",
  heading: "Questions buyers ask about Vercentlabs ERP.",
  questions: [
    {
      question: "What is Vercentlabs ERP?",
      answer: `Vercentlabs ERP is business management software — an ERP that runs the major functions of a business in one system: ${LAUNCH_BUSINESS_MODULE_COUNT} business modules on one Shared Platform, sharing one data model.`,
    },
    {
      question: "Which business functions does Vercentlabs ERP cover?",
      answer: `CRM, Sales, Procurement, Inventory, Manufacturing, Projects, Assets, POS, Quality, Support, HR & Payroll, and Accounting — ${LAUNCH_BUSINESS_MODULE_COUNT} business modules — plus a Shared Platform for tenants and companies, users, roles and permissions, audit logs, and import and export. Together that's ${LAUNCH_CAPABILITY_TOTAL} approved MVP capabilities.`,
    },
    {
      question: "Do the modules work together?",
      answer: "Yes. The modules share one data model, so records carry through — an opportunity becomes a quotation, an order reserves stock, and an invoice posts to the general ledger — without being re-typed. Each team still carries out its own steps; connected doesn't mean everything happens automatically.",
    },
    {
      question: "Can we enable only the modules we need?",
      answer: "Yes. Modules can be enabled or disabled per organisation within its subscription plan, so you can start with what you need and add more later on the same platform.",
    },
    {
      question: "How are users and permissions controlled?",
      answer: "Through roles and permissions checked on the server, record-level access, and company and branch access — with significant actions recorded in an audit log the database protects from edits and deletion.",
    },
    {
      question: "How can I evaluate Vercentlabs ERP?",
      answer: "Explore the product, module, and workflow pages on this site to see what each part of the ERP covers. For a walkthrough focused on your own processes, talk to an ERP specialist.",
    },
  ],
  analyticsId: "buyer_questions_view",
});

export const FINAL_CTA_SECTION = Object.freeze({
  id: "final-cta",
  eyebrow: SITE_IDENTITY.productName,
  heading: "See how your business can run in one connected ERP.",
  supportingText: "Explore the modules and workflows, or talk to an ERP specialist about the parts of your business you want to connect.",
  primaryCta: { ...CTAS.primary, analyticsId: "final_cta_click" },
  secondaryCta: { ...CTAS.talkToSpecialist, analyticsId: "final_secondary_cta_click" },
  analyticsId: "final_cta_view",
});

/** Ordered list of homepage sections — apps/landing/app/page.tsx renders exactly this sequence. */
export const HOMEPAGE_SECTIONS = Object.freeze([
  HERO,
  CONNECTED_ERP_SECTION,
  PROBLEM_SECTION,
  CONNECTED_WORKFLOWS_SECTION,
  MODULE_ARCHITECTURE_SECTION,
  PLATFORM_FOUNDATION_SECTION,
  ROLE_VALUE_SECTION,
  BREADTH_SECTION,
  EVALUATION_SECTION,
  IMPLEMENTATION_SECTION,
  SECURITY_SECTION,
  BUYER_QUESTIONS_SECTION,
  FINAL_CTA_SECTION,
]);
