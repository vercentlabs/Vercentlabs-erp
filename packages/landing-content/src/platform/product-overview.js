import {
  LAUNCH_BUSINESS_MODULE_COUNT,
  LAUNCH_CAPABILITY_COUNTS,
  LAUNCH_CAPABILITY_SUMMARY,
  SHARED_PLATFORM_KEY,
} from "../capabilities/launch-capabilities.js";
import { CTAS } from "../navigation.js";
import { ROUTED_WORKFLOW_SLUGS } from "../workflows.js";

/**
 * /product — the product evaluation hub: what Vercentlabs ERP is, what it
 * connects, and how the system is structured. It hands the visitor on to the
 * module, workflow and platform pages rather than repeating them.
 * Product statements must stay inside the approved launch capability register
 * (capabilities/launch-capabilities.js); counts are derived from it.
 */
export const PRODUCT_OVERVIEW_PAGE = Object.freeze({
  slug: "/product",
  title: "Product Overview",
  metaDescription:
    "Vercentlabs ERP connects 12 business modules on one Shared Platform — one data model, roles and permissions, company and branch access, a protected audit log, and a responsive browser interface.",
  directDefinition: `Vercentlabs ERP is a multi-tenant, multi-company ERP with ${LAUNCH_CAPABILITY_SUMMARY} — modules covering revenue, operations, finance, people and service, and delivery that share one data model, one role and permission system, and one audit log, instead of separate tools that happen to export to the same spreadsheet.`,
  eyebrow: "Product overview",
  heading: "One system for the major functions of your business.",
  supportingText: `${LAUNCH_BUSINESS_MODULE_COUNT} business modules, from CRM and Sales to Inventory, HR & Payroll and Accounting, connected by cross-module workflows and running on one Shared Platform for access, audit and data integrity.`,
  primaryCta: { label: "Explore the modules", href: "/modules" },
  secondaryCta: { label: "See connected workflows", href: "/workflows" },
  facts: [
    { value: String(LAUNCH_BUSINESS_MODULE_COUNT), label: "business modules" },
    { value: String(ROUTED_WORKFLOW_SLUGS.length), label: "documented workflows" },
    { value: String(LAUNCH_CAPABILITY_COUNTS[SHARED_PLATFORM_KEY]), label: "Shared Platform capabilities" },
  ],
  architecture: {
    eyebrow: "System architecture",
    heading: "Modules are parts of one ERP, not separately integrated products.",
    supportingText:
      "Each module manages one area of the business. Where work crosses from one module to the next, connected workflows carry the record over — an opportunity becomes a quotation, a goods receipt updates stock, an invoice posts to the ledger. Every module runs on the same Shared Platform for users, permissions, audit and data integrity.",
    layers: [
      { key: "modules", title: "Business modules", description: "Where each team works: CRM, Sales, Procurement, Inventory, Manufacturing and the rest." },
      { key: "workflows", title: "Connected workflows", description: "Where work crosses a module boundary, the record carries over instead of being re-typed." },
      { key: "platform", title: "Shared Platform", description: "The controls every module inherits: access, business structure, data integrity, traceability, operations and experience." },
    ],
  },
  evidence: {
    eyebrow: "Product evidence",
    heading: "The current product, shown with a fictional demo company.",
    supportingText: "Screens captured from the current Vercentlabs ERP. Every customer, supplier and person in them is synthetic demo data.",
    primaryScreenshotId: "crm-opportunity-pipeline",
    secondaryScreenshotId: "accounting-customer-invoices",
  },
  modulesSection: {
    eyebrow: "The modules",
    heading: `${LAUNCH_BUSINESS_MODULE_COUNT} modules, each with a clear job.`,
    supportingText: "Each module page lists the approved launch capabilities it includes, the workflows it takes part in, and the modules it connects to.",
  },
  workflowsSection: {
    eyebrow: "Connected workflows",
    heading: "How work moves from one module to the next.",
    supportingText: "Each workflow is a sequence of approved capabilities, with the module that owns every step and the point where the record is handed on.",
  },
  platformSection: {
    eyebrow: "Shared Platform",
    heading: "Common controls under every module.",
    supportingText: `The ${LAUNCH_CAPABILITY_COUNTS[SHARED_PLATFORM_KEY]} Shared Platform capabilities work the same way in every module, so access, audit and data integrity are configured once.`,
    cta: { label: "See the Shared Platform", href: "/product/platform" },
  },
  controlsSection: {
    eyebrow: "Access and control",
    heading: "Role-based, record-level, and scoped by company and branch.",
    items: [
      { title: "Roles and permissions", description: "Each person's role decides what they can see and do, checked on the server." },
      { title: "Record-level access", description: "Access can be limited to the records a person is responsible for." },
      { title: "Companies and branches", description: "An organisation can run several companies and branches, and access can be scoped to them." },
      { title: "Protected audit log", description: "Significant actions are recorded in an audit log the database protects from edits and deletion." },
    ],
    cta: { label: "See the security architecture", href: "/security" },
  },
  evaluation: {
    eyebrow: "Evaluate on your terms",
    heading: "Go as deep as you need before talking to anyone.",
  },
  finalCta: {
    heading: "Start with the modules your business needs.",
    supportingText: "Modules are enabled per organisation, so you can start with what you need and add more later on the same platform.",
    primaryCta: { label: "Explore the modules", href: "/modules" },
    secondaryCta: { ...CTAS.talkToSpecialist },
  },
  faqSection: { eyebrow: "Buyer questions", heading: "Questions about how the system fits together." },
  faqs: [
    { question: "Is Vercentlabs one application or twelve separate products bundled together?", answer: "One application — 12 modules run on one Shared Platform and data model. Modules can be enabled or disabled per organisation, so you can start with what you need and add more later without switching systems." },
    { question: "How does Vercentlabs handle multiple companies or branches?", answer: "An organisation can run several companies and branches, and access can be scoped to specific companies and branches through permissions and query-level controls in the application." },
    { question: "Can we adopt modules gradually instead of all at once?", answer: "Yes — modules are enabled or disabled per organisation, so you can start with the modules you need and add more as you grow, on the same underlying platform and data model." },
  ],
});
