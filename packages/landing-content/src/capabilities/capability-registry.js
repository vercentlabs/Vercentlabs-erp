import { LANDING_MODULES } from "../modules/index.js";
import { SHARED_PLATFORM_KEY, launchCapabilityNames } from "./launch-capabilities.js";

/**
 * Capability groups — the public, buyer-facing grouping of the approved launch
 * capability register (launch-capabilities.js). Every group lists register
 * capability IDs; across all groups each of the register's capabilities
 * appears exactly once (enforced by tests), so a group-level view (module
 * pages, the requirements checklist) always covers the full approved scope
 * and nothing outside it.
 *
 * Module groups are read directly from each module's `capabilityGroups` in
 * modules.js, so this file can't drift from what a module page renders.
 * Shared Platform groups are declared below and map to the platform page that
 * describes them.
 */

function moduleCapabilityGroups() {
  return LANDING_MODULES.flatMap((module) =>
    module.capabilityGroups.map((group) => ({
      id: group.id,
      name: group.name,
      moduleId: module.key,
      platformArea: undefined,
      description: group.description,
      capabilityIds: group.capabilityIds,
      capabilities: group.capabilities,
      workflowSlugs: group.workflowSlug ? [group.workflowSlug] : [],
      publicPage: `/modules/${module.key}`,
      publicSection: group.name,
      searchTopics: [module.name, group.name],
    })),
  );
}

function platformGroup({ id, name, platformArea, description, capabilityIds, publicPage, searchTopics }) {
  return {
    id,
    name,
    moduleId: undefined,
    platformArea,
    description,
    capabilityIds,
    capabilities: launchCapabilityNames(capabilityIds),
    workflowSlugs: [],
    publicPage,
    publicSection: name,
    searchTopics,
  };
}

const PLATFORM_CAPABILITY_GROUPS = Object.freeze([
  platformGroup({
    id: "platform-tenant-company-settings",
    name: "Tenants, companies & settings",
    platformArea: "platform",
    description: "Organisations and companies, their settings, currency, timezone, date formats, tax configuration, document numbering, and which modules and plan each organisation has enabled.",
    capabilityIds: [
      "platform-tenant-management",
      "platform-company-management",
      "platform-company-settings",
      "platform-currency",
      "platform-timezone",
      "platform-date-time-formats",
      "platform-tax-configuration",
      "platform-document-numbering",
      "platform-module-enable-disable",
      "platform-subscription-plan-enforcement",
    ],
    publicPage: "/product/platform",
    searchTopics: ["multi-company ERP", "multi-tenant ERP"],
  }),
  platformGroup({
    id: "platform-identity-access",
    name: "Users, roles & access",
    platformArea: "security",
    description: "Sign-in and sessions, user invitation and activation, roles and permissions, record-level access, and company and branch access.",
    capabilityIds: [
      "platform-authentication",
      "platform-login-logout",
      "platform-forgot-reset-password",
      "platform-session-management",
      "platform-user-management",
      "platform-user-invitation",
      "platform-activation-deactivation",
      "platform-roles",
      "platform-permissions",
      "platform-record-level-access",
      "platform-company-branch-access",
    ],
    publicPage: "/security",
    searchTopics: ["ERP roles and permissions", "role-based access control ERP"],
  }),
  platformGroup({
    id: "platform-audit-history",
    name: "Audit logs & activity history",
    platformArea: "security",
    description: "A platform audit log the database protects from edits and deletion, and the activity history of each record.",
    capabilityIds: ["platform-audit-logs", "platform-activity-history"],
    publicPage: "/security",
    searchTopics: ["ERP audit trail", "immutable audit log"],
  }),
  platformGroup({
    id: "platform-collaboration-documents",
    name: "Collaboration & documents",
    platformArea: "platform",
    description: "Comments, attachments, and notifications on records, and PDF and print output for business documents.",
    capabilityIds: ["platform-comments", "platform-attachments", "platform-notifications", "platform-pdf-print"],
    publicPage: "/product/platform",
    searchTopics: ["ERP document management", "ERP notifications"],
  }),
  platformGroup({
    id: "platform-data-handling",
    name: "Finding, importing & exporting data",
    platformArea: "analytics",
    description: "Search, filtering, sorting, and pagination across records, plus import and export.",
    capabilityIds: ["platform-import", "platform-export", "platform-search", "platform-filtering", "platform-sorting", "platform-pagination"],
    publicPage: "/product/analytics",
    searchTopics: ["ERP data import", "ERP reporting and analytics"],
  }),
  platformGroup({
    id: "platform-reliability",
    name: "Reliability & data integrity",
    platformArea: "platform",
    description: "Validation, transaction safety, idempotency, concurrency protection, error handling, backups and restore, logging, and monitoring and health checks.",
    capabilityIds: [
      "platform-validation",
      "platform-transaction-safety",
      "platform-idempotency",
      "platform-concurrency-protection",
      "platform-error-handling",
      "platform-backups",
      "platform-restore-process",
      "platform-logging",
      "platform-monitoring",
      "platform-health-checks",
    ],
    publicPage: "/product/platform",
    searchTopics: ["ERP data integrity", "ERP backups"],
  }),
  platformGroup({
    id: "platform-interface-access",
    name: "Responsive interface & navigation",
    platformArea: "mobile",
    description: "A responsive browser interface usable on desktop, tablet, and phone browsers, with clear loading, empty, and error states, and navigation that shows each user the areas their permissions allow.",
    capabilityIds: ["platform-loading-empty-error-states", "platform-responsive-ui", "platform-permission-aware-navigation"],
    publicPage: "/product/mobile",
    searchTopics: ["responsive ERP", "ERP on mobile browser"],
  }),
]);

export const CAPABILITY_GROUPS = Object.freeze([...moduleCapabilityGroups(), ...PLATFORM_CAPABILITY_GROUPS].map((group) => Object.freeze(group)));

export const SHARED_PLATFORM_CAPABILITY_GROUPS = Object.freeze(CAPABILITY_GROUPS.filter((group) => group.platformArea));

export function getCapabilityGroupsForModule(moduleKey) {
  return CAPABILITY_GROUPS.filter((group) => group.moduleId === moduleKey);
}

export function getCapabilityGroupsForPlatformArea(platformArea) {
  return CAPABILITY_GROUPS.filter((group) => group.platformArea === platformArea);
}

/** Owner key a capability group belongs to: its module key, or the Shared Platform key. */
export function getCapabilityGroupOwner(group) {
  return group.moduleId ?? SHARED_PLATFORM_KEY;
}
