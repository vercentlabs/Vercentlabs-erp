// Shared Access — public boundary.
//
// The ONE place server code composes authentication, workspace membership,
// module availability/enablement/entitlement, permissions, company/branch
// scope and field rules. Import from "@vercentlabs/api/access" (or the root
// "@vercentlabs/api" barrel); never from the files behind it.
//
// See docs/01-standards/SHARED_PLATFORM_ARCHITECTURE.md.
export {
  ACCESS_ERROR_CODES,
  AccessDeniedError,
  LEGACY_ACCESS_CODE_ALIASES,
  accessStatusFor,
  canonicalAccessCode,
  denialToError,
  isAccessDeniedError,
} from "./errors.js";
export {
  CLIENT_TENANT_IDENTITY_KEYS,
  assertNoClientTenantOverride,
  createAccessPrincipal,
  isUuid,
  mfaAssuranceSatisfied,
  permissionUnion,
  principalHasPermission,
  principalToDomainContext,
  withoutClientTenantIdentity,
} from "./principal.js";
export { assembleWorkspaceAccessSnapshot, buildWorkspaceAccessSnapshot } from "./access-snapshot.js";
export {
  MODULE_ACCESS_PERMISSIONS,
  checkSnapshotModuleAccess,
  moduleAccessDenialCode,
  moduleAccessPermission,
  snapshotModuleAccess,
} from "./module-access.js";
export {
  canAccessBranch,
  canAccessCompany,
  checkBranchScope,
  checkCompanyScope,
  checkOrganizationScope,
} from "./scope-access.js";
export { assertWritableFields, hiddenFieldsFor, projectFields } from "./field-access.js";
export { authorize, requireAuthorization } from "./authorization.js";
export { assertNoBlockingSodConflict } from "./administration.js";
export { accessLogFields, logAccessDenial, recordAccessDenial } from "./audit.js";
