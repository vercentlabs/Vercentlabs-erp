import { LAUNCH_BUSINESS_MODULE_COUNT } from "../capabilities/launch-capabilities.js";
import { CTAS } from "../navigation.js";

/**
 * /modules — the module map: all 12 business modules grouped by operating
 * domain, plus example operating stacks.
 */
export const MODULES_INDEX_PAGE = Object.freeze({
  slug: "/modules",
  title: "Modules",
  metaDescription:
    "All 12 Vercentlabs ERP modules, grouped by revenue, operations, finance, people & service, and delivery — with example operating stacks for manufacturing, distribution, retail, and project-based service businesses.",
  directDefinition: `Vercentlabs ERP is organised into ${LAUNCH_BUSINESS_MODULE_COUNT} business modules across five operational categories — Revenue, Operations, Finance, People & Service, and Delivery — that share one Shared Platform and data model, so you can adopt what you need now and add more later without switching systems.`,
  eyebrow: "The modules",
  heading: `${LAUNCH_BUSINESS_MODULE_COUNT} business modules. One connected ERP.`,
  supportingText:
    "Every module runs on the same data model, role system and audit log. Modules are enabled or disabled per organisation, not sold as separate products.",
  groupsSection: {
    eyebrow: "Module map",
    heading: "Grouped by the part of the business they run.",
    supportingText: "The groups are a reading aid. Every module is part of the same ERP and can be adopted on its own or alongside the others.",
  },
  relationshipsSection: {
    eyebrow: "How the modules connect",
    heading: "Records move between modules through real workflows.",
    supportingText: "Each path below is a documented workflow: the record moves from one module to the next as the work progresses. The other connections are the handoffs each module describes on its own page.",
  },
  platformSection: {
    eyebrow: "Shared Platform",
    heading: "Twelve modules, one platform underneath.",
    supportingText: "Users, roles and permissions, company and branch access, audit logs, import and export, and data integrity controls work the same way in every module.",
    cta: { label: "See the Shared Platform", href: "/product/platform" },
  },
  stacksSection: {
    eyebrow: "Start with what you need",
    heading: "Common starting combinations.",
    supportingText: "Module access is enabled per organisation. These combinations show how modules are often adopted together, not packages you have to buy.",
  },
  finalCta: {
    heading: "See how the modules work together.",
    supportingText: "Follow a workflow across the modules that run it, or talk to an ERP specialist about the parts of your business you want to connect.",
    primaryCta: { label: "Browse workflows", href: "/workflows" },
    secondaryCta: { ...CTAS.talkToSpecialist },
  },
  operatingStacks: [
    {
      id: "manufacturing-stack",
      name: "Manufacturing operating stack",
      description: "Manufacturing orders checked against real material availability, with quality inspections and the books connected to actual production.",
      moduleKeys: ["manufacturing", "stock", "procurement", "quality", "accounting"],
    },
    {
      id: "distribution-stack",
      name: "Distribution operating stack",
      description: "Multi-warehouse stock feeding sales orders and purchasing, with a single customer record across every touchpoint.",
      moduleKeys: ["stock", "procurement", "sales", "crm", "accounting"],
    },
    {
      id: "retail-stack",
      name: "Retail operating stack",
      description: "Checkout that reduces real inventory as the sale completes, with the same stock ledger backing every store.",
      moduleKeys: ["point-of-sale", "stock", "procurement", "crm"],
    },
    {
      id: "project-service-stack",
      name: "Project-based service operating stack",
      description: "Projects, tasks, and timesheets alongside the customers, quotations, and support tickets they relate to.",
      moduleKeys: ["projects", "crm", "sales", "support", "hr-payroll"],
    },
  ],
});

/**
 * Section copy shared by every /modules/[slug] page. Module-specific content
 * lives in each module file; these are the frames around it.
 */
export const MODULE_DETAIL_PAGE = Object.freeze({
  evidenceEyebrow: "Product evidence",
  evidenceFallbackLabel: "How work runs in this module",
  managesEyebrow: "What it manages",
  managesHeading: (name) => `What ${name} gives your team.`,
  capabilitiesEyebrow: "Approved capabilities",
  capabilitiesHeading: (name, count) => `${count} approved capabilities in ${name}.`,
  capabilitiesSupportingText: "Every capability below is part of the approved launch scope, grouped by the work it supports.",
  workflowEyebrow: "Connected workflow",
  workflowHeading: (name) => `Where ${name} sits in the work.`,
  connectionsEyebrow: "Connections",
  connectionsHeading: (name) => `What ${name} connects to.`,
  platformEyebrow: "Shared Platform",
  platformHeading: "Inherited from the Shared Platform.",
  platformSupportingText: "Like every module, this one runs on the Shared Platform, so these controls work the same way here as everywhere else.",
  faqEyebrow: "Buyer questions",
  faqHeading: (name) => `Questions teams ask about ${name}.`,
  relatedEyebrow: "Keep exploring",
});
