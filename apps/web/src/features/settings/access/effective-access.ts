import { CRM_PERMISSIONS, MODULE_ACCESS_PERMISSIONS } from "@vercentlabs/permissions";
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

// What a person can do once their roles are combined — for display only.
// Session permissions are the UNION of every active role
// (services/api/src/core/session.js), so this mirrors that rule, never the
// primary role alone. Every decision is still made on the server; this is a
// readable summary, not an authorization engine, and deliberately not a
// 290-permission wall (the full list stays in advanced role editing).

type RoleLike = { slug: string; permission_keys: readonly string[] };

export type ModuleAccessLevel = "none" | "view" | "operate" | "administer";

export type ModuleAccessSummary = {
  key: string;
  name: string;
  level: ModuleAccessLevel;
  /** Human sentence, e.g. "Day-to-day work" or "Their own and their team's records". */
  detail: string;
};

export type EffectiveAccessSummary = {
  permissionCount: number;
  modules: ModuleAccessSummary[];
  administration: string[];
  highRisk: string[];
};

const LEVEL_LABEL: Record<ModuleAccessLevel, string> = {
  none: "No access",
  view: "View and reports",
  operate: "Day-to-day work",
  administer: "Full module administration",
};

const ADMINISTRATION: ReadonlyArray<[string, string]> = [
  ["organization.manage", "Organisation settings and new companies"],
  ["modules.manage", "Turn modules on or off"],
  ["roles.manage", "Define roles"],
  ["roles.assign", "Assign roles"],
  ["users.manage", "Manage users and their access"],
  ["company.manage", "Manage companies"],
  ["branch.manage", "Manage branches"],
  ["billing.manage", "Billing and plan"],
  ["platform.security.manage", "Organisation security policy"],
];

const ORGANISATION_HIGH_RISK: ReadonlyArray<[string, string]> = [
  ["access.sod.override", "Override separation-of-duties warnings"],
  ["audit.view", "Organisation audit log"],
  ["platform.privacy.manage", "Privacy requests"],
  ["billing.manage", "Billing and plan changes"],
];

const CRM_RECORD_SCOPE: Record<"all" | "team", string> = {
  all: "All CRM records in their companies",
  team: "Their own and their sales team's CRM records",
};

function modulePrefix(viewPermission: string) {
  return viewPermission.slice(0, viewPermission.lastIndexOf(".") + 1);
}

function isReadOnly(key: string) {
  return /\.(view|reports\.view|view_all|audit\.view)$/.test(key) || key.endsWith(".view") || key.includes(".view_");
}

function highRiskLabel(key: string, moduleName: string): string | null {
  if (/sensitive/.test(key)) return `${moduleName}: sensitive data`;
  if (/\.export$/.test(key)) return `${moduleName}: export data`;
  if (/\.import$/.test(key)) return `${moduleName}: import data`;
  if (/\.(approve|finalize|post)$/.test(key)) return `${moduleName}: approvals and posting`;
  if (/settings\.manage$/.test(key)) return `${moduleName}: module settings`;
  if (/privacy\.manage$/.test(key)) return `${moduleName}: privacy requests`;
  return null;
}

export function summarizeEffectiveAccess(roles: readonly RoleLike[]): EffectiveAccessSummary {
  const owner = roles.some((role) => role.slug === "organization_owner");
  const permissions = new Set(roles.flatMap((role) => role.permission_keys));
  const has = (key: string) => owner || permissions.has(key);
  const highRisk = new Set<string>();

  const modules = ERP_MODULE_CATALOG.map((module): ModuleAccessSummary => {
    const view = MODULE_ACCESS_PERMISSIONS[module.key];
    if (!view || !has(view)) return { key: module.key, name: module.name, level: "none", detail: LEVEL_LABEL.none };
    const prefix = modulePrefix(view);
    const keys = owner ? ["__owner__"] : [...permissions].filter((key) => key.startsWith(prefix));
    for (const key of keys) {
      const label = highRiskLabel(key, module.name);
      if (label) highRisk.add(label);
    }
    let level: ModuleAccessLevel = "view";
    if (owner || has(`${prefix}settings.manage`)) level = "administer";
    else if (keys.some((key) => !isReadOnly(key))) level = "operate";
    let detail = LEVEL_LABEL[level];
    if (module.key === "crm") {
      detail = `${detail} · ${has(CRM_PERMISSIONS.recordsViewAll) ? CRM_RECORD_SCOPE.all : CRM_RECORD_SCOPE.team}`;
    }
    return { key: module.key, name: module.name, level, detail };
  });

  if (owner) highRisk.add("Everything in every module (Organisation Owner)");
  for (const [key, label] of ORGANISATION_HIGH_RISK) if (has(key)) highRisk.add(label);

  return {
    permissionCount: permissions.size,
    modules,
    administration: ADMINISTRATION.filter(([key]) => has(key)).map(([, label]) => label),
    highRisk: [...highRisk],
  };
}

export const MODULE_ACCESS_LEVEL_LABEL = LEVEL_LABEL;
