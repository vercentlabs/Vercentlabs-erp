// The canonical server-side access principal: the authenticated actor,
// reduced to the security-relevant facts every authorization decision needs.
//
// Built ONLY from a server-resolved session (resolveSessionContext in
// ../session.js) plus server-resolved company/branch grants — never from
// request input. Business modules receive this shape instead of inventing
// their own `{ organizationId, userId, permissions, … }` contexts.
import { PERMISSION_BYPASS_ROLE_SLUGS, UNRESTRICTED_SCOPE_ROLE_SLUGS } from "@vercentlabs/permissions";

import { ACCESS_ERROR_CODES, AccessDeniedError } from "./errors.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Request-body/query/path keys that claim a tenant identity. The server
// never reads tenant identity from these; a caller supplying one that
// disagrees with the session is refused outright rather than silently
// ignored, so a confused client is noticed.
export const CLIENT_TENANT_IDENTITY_KEYS = Object.freeze(["organizationId", "organization_id", "orgId", "tenantId", "tenant_id"]);

export function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function sortedUnique(values) {
  return Object.freeze([...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value))].sort());
}

// Union of permissions across every active role assignment. Session
// resolution already computes this in SQL; this pure form exists for callers
// that combine role grants themselves (tests, administration previews).
export function permissionUnion(roleGrants) {
  const permissions = new Set();
  for (const grant of roleGrants || []) for (const permission of grant?.permissions || []) permissions.add(permission);
  return Object.freeze([...permissions].sort());
}

export function mfaAssuranceSatisfied(session) {
  return !((session.mfaEnrolled || session.mfaPolicyRequired) && !session.mfaVerified);
}

// scope: optional server-resolved grants, e.g. from listAccessibleCompanies.
// When omitted, the principal carries only the active company/branch and
// `companyScope.resolved` is false — callers needing full scope must build
// a WorkspaceAccessSnapshot instead.
export function createAccessPrincipal(session, scope = {}) {
  if (!session || !session.userId) {
    throw new AccessDeniedError(ACCESS_ERROR_CODES.AUTH_REQUIRED);
  }
  if (!session.organizationId || !isUuid(session.organizationId)) {
    throw new AccessDeniedError(ACCESS_ERROR_CODES.MEMBERSHIP_INACTIVE);
  }
  const roleSlugs = sortedUnique(session.roleSlugs);
  const unrestrictedScope = roleSlugs.some((slug) => UNRESTRICTED_SCOPE_ROLE_SLUGS.includes(slug));
  const resolved = Array.isArray(scope.companyIds) && Array.isArray(scope.branchIds);
  return Object.freeze({
    kind: "user",
    userId: session.userId,
    sessionId: session.sessionId ?? null,
    organizationId: session.organizationId,
    roleSlugs,
    permissions: sortedUnique(session.permissions),
    permissionBypass: roleSlugs.some((slug) => PERMISSION_BYPASS_ROLE_SLUGS.includes(slug)),
    activeCompanyId: session.activeCompanyId ?? null,
    activeBranchId: session.activeBranchId ?? null,
    companyScope: Object.freeze({
      unrestricted: unrestrictedScope,
      resolved,
      companyIds: resolved ? sortedUnique(scope.companyIds) : sortedUnique([session.activeCompanyId]),
      branchIds: resolved ? sortedUnique(scope.branchIds) : sortedUnique([session.activeBranchId]),
    }),
    locale: session.locale ?? null,
    timezone: session.timezone ?? null,
    assurance: Object.freeze({
      emailVerified: Boolean(session.emailVerified),
      mfaEnrolled: Boolean(session.mfaEnrolled),
      mfaPolicyRequired: Boolean(session.mfaPolicyRequired),
      mfaVerified: Boolean(session.mfaVerified),
      mfaSatisfied: mfaAssuranceSatisfied(session),
    }),
  });
}

export function principalHasPermission(principal, permission) {
  if (!principal || !permission) return false;
  if (principal.permissionBypass) return true;
  return principal.permissions.includes(permission);
}

// Refuses any client-supplied tenant identity that disagrees with the
// authenticated principal. Accepts plain objects and URLSearchParams.
export function assertNoClientTenantOverride(input, principal) {
  if (!input || typeof input !== "object") return;
  const read = input instanceof URLSearchParams ? (key) => input.get(key) : (key) => (Object.prototype.hasOwnProperty.call(input, key) ? input[key] : null);
  for (const key of CLIENT_TENANT_IDENTITY_KEYS) {
    const value = read(key);
    if (value === null || value === undefined || value === "") continue;
    if (value !== principal.organizationId) {
      throw new AccessDeniedError(ACCESS_ERROR_CODES.SCOPE_DENIED, { reason: "client_tenant_override" });
    }
  }
}

// Removes tenant identity claims from a client payload before it reaches a
// domain function, so domain code can only ever see the principal's tenant.
export function withoutClientTenantIdentity(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const copy = { ...input };
  for (const key of CLIENT_TENANT_IDENTITY_KEYS) delete copy[key];
  return copy;
}

// Compatibility adapter: the legacy `{ organizationId, userId, roleSlugs,
// permissions, activeCompanyId, activeBranchId }` shape many domain modules
// accept, derived from the principal instead of re-reading the session.
export function principalToDomainContext(principal) {
  return {
    organizationId: principal.organizationId,
    userId: principal.userId,
    roleSlugs: [...principal.roleSlugs],
    permissions: [...principal.permissions],
    activeCompanyId: principal.activeCompanyId,
    activeBranchId: principal.activeBranchId,
    allowAllCompanies: principal.companyScope.unrestricted,
  };
}
