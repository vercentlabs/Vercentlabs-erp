export const CURRENT_MODULE_KEYS: readonly [
  "platform",
  "crm",
  "sales",
  "accounting",
  "procurement",
  "stock",
  "manufacturing",
  "projects",
  "assets",
  "point-of-sale",
  "quality",
  "support",
  "hr-payroll",
];

export type AccessModuleKey = (typeof CURRENT_MODULE_KEYS)[number];

export type RoleRiskLevel = "standard" | "sensitive" | "privileged";

export type RoleTemplate = {
  name: string;
  slug: string;
  description: string;
  moduleKey: AccessModuleKey;
  riskLevel: RoleRiskLevel;
  assignable: boolean;
  permissions: readonly string[];
};

export const ROLE_TEMPLATES: readonly RoleTemplate[];
export const ROLE_TEMPLATE_BY_SLUG: ReadonlyMap<string, RoleTemplate>;

export function permissionsForRole(slug: string): string[];

export type SodConflict = {
  key: string;
  first: string;
  second: string;
  severity: "warning" | "blocking";
  description: string;
};

export const SOD_CONFLICTS: readonly SodConflict[];

export function analyzePermissionConflicts(
  permissionKeys: readonly string[],
): SodConflict[];

export function permissionsOutsideGrantCeiling(
  actorRoleSlugs: readonly string[],
  actorPermissions: readonly string[],
  requestedPermissions: readonly string[],
): string[];

export function roleIsAvailable(
  moduleKey: string | null | undefined,
  assignable: boolean,
  enabledModules: readonly string[],
): boolean;
