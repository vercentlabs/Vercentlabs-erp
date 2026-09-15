// Reconstructed gap: the recovered snapshot (docs/frontend-rebuild/
// recovered-platform-code) imported `hasPermission`/`PERMISSIONS` from
// "@/core/authorization" in six-plus files, but that source file was never
// itself among the 42 recovered files — either it predates the archive
// point or was lost earlier. It is rebuilt here from the one inline
// duplicate that WAS recovered (shared-platform.ts's sessionHasPermission:
// "session.roleSlugs.includes('organization_owner') || session.permissions
// .includes(permission)") rather than invented from nothing. See
// docs/frontend-rebuild/PLATFORM_PORT_REGISTER.csv, the "(gap - referenced
// but not recovered)" row.
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

export const PERMISSIONS = CORE_PERMISSIONS;

// Named hasSessionPermission (not hasPermission) because several existing
// services/api business modules (e.g. modules/accounting/core.js) already
// export their own local hasPermission with this exact same logic — this
// package's `export *` barrel would silently drop either export as an
// ambiguous binding if the names collided. This is the canonical version
// for new platform/session/shell code to import; existing modules' local
// copies are unchanged (out of this prompt's scope to consolidate).
export function hasSessionPermission(session, permission) {
  if (!session) return false;
  if (Array.isArray(session.roleSlugs) && session.roleSlugs.includes("organization_owner")) {
    return true;
  }
  return Array.isArray(session.permissions) && session.permissions.includes(permission);
}

export class PermissionDeniedError extends Error {
  constructor(permission) {
    super(`You do not have permission to perform this action (${permission}).`);
    this.name = "PermissionDeniedError";
    this.status = 403;
    this.code = "PERMISSION_DENIED";
    this.permission = permission;
  }
}

export function requireSessionPermission(session, permission) {
  if (!hasSessionPermission(session, permission)) {
    throw new PermissionDeniedError(permission);
  }
  return session;
}
