export const MODULE_ACCESS_PERMISSIONS: Readonly<Record<string, string>>;
export const UNRESTRICTED_SCOPE_ROLE_SLUGS: readonly ["organization_owner", "system_administrator"];
export const PERMISSION_BYPASS_ROLE_SLUGS: readonly ["organization_owner"];
export function moduleAccessPermission(moduleKey: string): string | null;
