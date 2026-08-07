import { LANDING_MODULES } from "./modules.js";

/**
 * Capability-group traceability registry — see docs/landing-redesign/phase-4/
 * capability-traceability.md for the full methodology. Two things this file is
 * NOT: (1) an independent re-audit of the 945+94=1,039 requirement count
 * (CLAUDE.md treats that as settled); (2) a literal list of 1,039 individually
 * named requirements (no such list exists anywhere in the repository — the one
 * static feature register is flagged unreliable, see docs/landing-redesign/
 * phase-1/decision-log.md item 3). This registry operates at the granularity
 * the repository actually supports and evidences: real, product-intelligence.md-
 * grounded capability groups, each carrying an honest requirementCount
 * allocation of the settled total. docs/landing-redesign/phase-1/
 * information-architecture.md's own anti-cannibalisation rule confirms this is
 * the right granularity: "No feature-level URL exists for any of the 1,039
 * individual requirements — they live as capability-group content inside their
 * module page."
 *
 * Module-specific groups (945 total) are read directly from each module's
 * `capabilityGroups` in modules.js — the single source of truth — so this file
 * can never drift out of sync with what a module page actually renders.
 */

function moduleCapabilityGroups() {
  return LANDING_MODULES.flatMap((module) =>
    module.capabilityGroups.map((group) => ({
      id: group.id,
      name: group.name,
      moduleId: module.key,
      platformArea: undefined,
      description: group.description,
      requirementCount: group.requirementCount,
      workflowSlugs: group.workflowSlug ? [group.workflowSlug] : [],
      publicPage: `/modules/${module.key}`,
      publicSection: group.name,
      searchTopics: [module.name, group.name],
    })),
  );
}

/**
 * Shared-platform capability groups (94 total) — sourced from product-
 * intelligence.md's "Shared Platform" profile. Each maps to the platform page
 * that owns that capability in depth, per the IA's anti-cannibalisation rule
 * ("a capability is described once in depth on /product/platform and
 * referenced, not re-explained, from every module page").
 */
const PLATFORM_CAPABILITY_GROUPS = Object.freeze([
  {
    id: "platform-tenant-structure",
    name: "Tenant & multi-company structure",
    moduleId: undefined,
    platformArea: "platform",
    description:
      "Organizations, companies, branches, departments, cost centers, and teams with granular, membership-scoped access — company, branch, or department, not all-or-nothing.",
    requirementCount: 18,
    workflowSlugs: ["tenant-onboarding-and-entitlement"],
    publicPage: "/product/platform",
    publicSection: "Tenant & multi-company structure",
    searchTopics: ["multi-company ERP", "multi-tenant ERP"],
  },
  {
    id: "platform-roles-permissions",
    name: "Roles & permissions",
    moduleId: undefined,
    platformArea: "security",
    description:
      "12 seeded system roles, time-bound role assignments with start/expiry dates, and framework-neutral permission-key packages per module.",
    requirementCount: 20,
    workflowSlugs: [],
    publicPage: "/security",
    publicSection: "Roles & permissions",
    searchTopics: ["ERP roles and permissions", "role-based access control ERP"],
  },
  {
    id: "platform-approvals-workflow",
    name: "Approvals & workflow engine",
    moduleId: undefined,
    platformArea: "automation",
    description:
      "A generic approval-requests system plus a governed command registry with reusable decision and separation-of-duties primitives, reused across Accounting, Sales, CRM, HR, Assets, Projects, POS, and Support.",
    requirementCount: 18,
    workflowSlugs: [],
    publicPage: "/product/automation",
    publicSection: "Approvals & workflow engine",
    searchTopics: ["ERP workflow automation", "ERP approval workflow"],
  },
  {
    id: "platform-audit-trail",
    name: "Audit trail",
    moduleId: undefined,
    platformArea: "security",
    description: "A database trigger makes the audit table immutable — UPDATE/DELETE are rejected at the Postgres level, not just the application level.",
    requirementCount: 12,
    workflowSlugs: [],
    publicPage: "/security",
    publicSection: "Immutable audit trail",
    searchTopics: ["ERP audit trail", "immutable audit log"],
  },
  {
    id: "platform-reporting-document-localization",
    name: "Reporting, document & localization primitives",
    moduleId: undefined,
    platformArea: "analytics",
    description:
      "Injection-safe CSV export with hard-capped pagination; MIME/size-allow-listed, SHA-256-hashed, quarantine-lifecycle document storage; India-default localization (en-IN, Asia/Kolkata, INR, April-start fiscal year).",
    requirementCount: 16,
    workflowSlugs: [],
    publicPage: "/product/analytics",
    publicSection: "Reporting & document primitives",
    searchTopics: ["ERP reporting and analytics", "ERP document management"],
  },
  {
    id: "platform-mobile-billing-security",
    name: "Mobile device security & billing entitlement",
    moduleId: undefined,
    platformArea: "mobile",
    description:
      "Device-bound mobile authentication (fingerprint-required login, secure-store tokens, biometric re-lock after 15 seconds background) and an idempotent, HMAC-verified, replay-protected subscription billing webhook pipeline.",
    requirementCount: 10,
    workflowSlugs: [],
    publicPage: "/product/mobile",
    publicSection: "Mobile security",
    searchTopics: ["mobile ERP", "ERP subscription billing"],
  },
]);

export const CAPABILITY_GROUPS = Object.freeze([...moduleCapabilityGroups(), ...PLATFORM_CAPABILITY_GROUPS]);

export function getCapabilityGroupsForModule(moduleKey) {
  return CAPABILITY_GROUPS.filter((group) => group.moduleId === moduleKey);
}

export function getCapabilityGroupsForPlatformArea(platformArea) {
  return CAPABILITY_GROUPS.filter((group) => group.platformArea === platformArea);
}

export function getModuleRequirementTotal() {
  return CAPABILITY_GROUPS.filter((group) => group.moduleId).reduce((sum, group) => sum + group.requirementCount, 0);
}

export function getPlatformRequirementTotal() {
  return CAPABILITY_GROUPS.filter((group) => group.platformArea).reduce((sum, group) => sum + group.requirementCount, 0);
}

export function getTotalRequirementCount() {
  return CAPABILITY_GROUPS.reduce((sum, group) => sum + group.requirementCount, 0);
}
