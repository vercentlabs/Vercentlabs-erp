// Session-level permission primitives. New code should prefer the Shared
// Access boundary (./access/index.js: createAccessPrincipal,
// principalHasPermission, authorize); these remain the compatibility layer
// every existing domain module and route already calls, and share the same
// canonical bypass-role list from @vercentlabs/permissions.
import { CORE_PERMISSIONS, PERMISSION_BYPASS_ROLE_SLUGS } from "@vercentlabs/permissions";

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
  if (Array.isArray(session.roleSlugs) && session.roleSlugs.some((slug) => PERMISSION_BYPASS_ROLE_SLUGS.includes(slug))) {
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
