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
export { ACCESS_EVIDENCE_EVENTS, accessLogFields, logAccessDenial, recordAccessAssignmentEvent, recordAccessDenial } from "./audit.js";

// Implementation services behind the boundary (moved from the flat core/ files):
// session permission checks, module entitlements, access administration and
// the field-visibility primitives used by module projections.
export * from "./control-runtime.js";
export * from "./module-entitlements.js";
export * from "./administration-service.js";
export { hasAnyOwnField, omitFields, omitFieldsFromRows } from "./field-visibility.js";
