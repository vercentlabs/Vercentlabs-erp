// Access administration public boundary: role catalogue, role/permission
// management, grant ceilings, separation of duties and delegated
// administration scope. Implementation stays in ../access-administration.js
// and ../organization-administration.js; this file is the stable import
// surface for Settings routes and future administration capabilities.
import { analyzePermissionConflicts } from "@vercentlabs/permissions";

import { ACCESS_ERROR_CODES, AccessDeniedError } from "./errors.js";

export {
  AccessAdministrationError,
  archiveRole,
  assertInvitationWithinAdministrationScope,
  assertUserWithinAdministrationScope,
  createRole,
  getUserAccessState,
  hasUnrestrictedAccessAdministration,
  listOrganizationRolesDetailed,
  listPermissionCatalog,
  recordRoleSnapshot,
  setUserRoles,
  updateRole,
  validateRoleSelection,
  validateScopeGrantCeiling,
} from "../access-administration.js";
export {
  analyzePermissionConflicts,
  permissionsOutsideGrantCeiling,
  ROLE_TEMPLATES,
  ROLE_TEMPLATE_BY_SLUG,
  SOD_CONFLICTS,
} from "@vercentlabs/permissions";

// Blocking SoD conflicts become a stable SOD_CONFLICT denial; warnings are
// returned for the caller to surface/acknowledge.
export function assertNoBlockingSodConflict(permissionKeys) {
  const conflicts = analyzePermissionConflicts(permissionKeys);
  const blocking = conflicts.filter((conflict) => conflict.severity === "blocking");
  if (blocking.length) {
    throw new AccessDeniedError(ACCESS_ERROR_CODES.SOD_CONFLICT, { reason: blocking.map((conflict) => conflict.key).join(",") });
  }
  return conflicts.filter((conflict) => conflict.severity !== "blocking");
}
