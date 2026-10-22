import {
  CRM_PERMISSIONS,
  MODULE_ACCESS_PERMISSIONS,
} from "@vercentlabs/permissions";
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

// What a person can do once their roles are combined — for display only.
// Session permissions are the UNION of every active role
// (services/api/src/core/auth/session.js), so this mirrors that rule, never the
// primary role alone. Every decision is still made on the server; this is a
// readable summary, not an authorization engine, and deliberately not a
// 290-permission wall (the full list stays in advanced role editing).

type RoleLike = { slug: string; permission_keys: readonly string[] };

type ModuleAccessLevel = "none" | "view" | "operate" | "administer";

type ModuleAccessSummary = {
  key: string;
  name: string;
  level: ModuleAccessLevel;
  /** Human sentence, e.g. "Can do the day-to-day work, on only their own records". */
  detail: string;
  /** The riskier things this module allows, in plain words: "export data", "change its settings"… */
  extras: string[];
};

export type EffectiveAccessSummary = {
  permissionCount: number;
  modules: ModuleAccessSummary[];
  administration: string[];
  highRisk: string[];
};

const LEVEL_LABEL: Record<ModuleAccessLevel, string> = {
  none: "No access",
  view: "Can look at it, but not change it",
  operate: "Can do the day-to-day work",
  administer: "Can do everything, including its settings",
};

const ADMINISTRATION: ReadonlyArray<[string, string]> = [
  ["organization.manage", "Organisation settings"],
  ["modules.manage", "Turn modules on or off"],
  ["roles.manage", "Define roles"],
  ["roles.assign", "Assign roles"],
  ["users.manage", "Manage users and their access"],
  ["billing.manage", "Billing and plan"],
  ["platform.security.manage", "Organisation security policy"],
];

const ORGANISATION_HIGH_RISK: ReadonlyArray<[string, string]> = [
  ["access.sod.override", "Override separation-of-duties warnings"],
  ["audit.view", "Organisation audit log"],
  ["platform.privacy.manage", "Privacy requests"],
  ["billing.manage", "Billing and plan changes"],
];

// Whose CRM records: everyone's (view_all), their team's (any CRM view_team), or only their own.
const CRM_RECORD_SCOPE = { all: "on every record", team: "on their team's records", own: "on only their own records" } as const;

function modulePrefix(viewPermission: string) {
  return viewPermission.slice(0, viewPermission.lastIndexOf(".") + 1);
}

function isReadOnly(key: string) {
  return (
    /\.(view|reports\.view|view_all|audit\.view)$/.test(key) ||
    key.endsWith(".view") ||
    key.includes(".view_")
  );
}

// The riskier abilities inside a module, in the order they are listed.
const EXTRAS: ReadonlyArray<[RegExp, string]> = [
  [/\.export$/, "export data"],
  [/\.import$/, "import data"],
  [/sensitive/, "see sensitive details"],
  [/\.(approve|finalize|post)$/, "approve and post"],
  [/privacy\.manage$/, "handle privacy requests"],
  [/settings\.manage$/, "change its settings"],
];

export function summarizeEffectiveAccess(
  roles: readonly RoleLike[],
): EffectiveAccessSummary {
  const owner = roles.some((role) => role.slug === "organization_owner");
  const permissions = new Set(roles.flatMap((role) => role.permission_keys));
  const has = (key: string) => owner || permissions.has(key);
  const highRisk = new Set<string>();

  const modules = ERP_MODULE_CATALOG.map((module): ModuleAccessSummary => {
    const view = MODULE_ACCESS_PERMISSIONS[module.key];
    if (!view || !has(view))
      return {
        key: module.key,
        name: module.name,
        level: "none",
        detail: LEVEL_LABEL.none,
        extras: [],
      };
    const prefix = modulePrefix(view);
    const keys = owner
      ? ["__owner__"]
      : [...permissions].filter((key) => key.startsWith(prefix));
    const extras = owner ? EXTRAS.map(([, label]) => label) : EXTRAS.filter(([pattern]) => keys.some((key) => pattern.test(key))).map(([, label]) => label);
    let level: ModuleAccessLevel = "view";
    if (owner || has(`${prefix}settings.manage`)) level = "administer";
    else if (keys.some((key) => !isReadOnly(key))) level = "operate";
    let detail = LEVEL_LABEL[level];
    if (module.key === "crm") {
      const scope = has(CRM_PERMISSIONS.recordsViewAll) ? "all" : keys.some((key) => key.endsWith(".view_team")) ? "team" : "own";
      detail = `${detail}, ${CRM_RECORD_SCOPE[scope]}`;
    }
    return { key: module.key, name: module.name, level, detail, extras };
  });

  if (owner) highRisk.add("Everything in every module (Organisation Owner)");
  for (const [key, label] of ORGANISATION_HIGH_RISK)
    if (has(key)) highRisk.add(label);

  return {
    permissionCount: permissions.size,
    modules,
    administration: ADMINISTRATION.filter(([key]) => has(key)).map(
      ([, label]) => label,
    ),
    highRisk: [...highRisk],
  };
}
