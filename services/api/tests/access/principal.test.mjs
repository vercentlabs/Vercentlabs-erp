import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCESS_ERROR_CODES,
  AccessDeniedError,
  assertNoClientTenantOverride,
  createAccessPrincipal,
  permissionUnion,
  principalHasPermission,
  principalToDomainContext,
  withoutClientTenantIdentity,
} from "../../src/core/access/index.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

function session(overrides = {}) {
  return {
    sessionId: "s-1",
    userId: "u-1",
    organizationId: ORG,
    roleSlugs: ["sales_representative", "crm_administrator", "sales_representative"],
    permissions: ["crm.view", "crm.leads.manage", "crm.view"],
    activeCompanyId: "c-1",
    activeBranchId: "b-1",
    locale: "en-IN",
    timezone: "Asia/Kolkata",
    emailVerified: true,
    mfaEnrolled: false,
    mfaPolicyRequired: false,
    mfaVerified: false,
    email: "person@example.com",
    ...overrides,
  };
}

test("a valid principal carries only security-relevant, normalized, frozen facts", () => {
  const principal = createAccessPrincipal(session(), { companyIds: ["c-2", "c-1"], branchIds: ["b-1"] });
  assert.equal(principal.organizationId, ORG);
  assert.equal(principal.userId, "u-1");
  assert.deepEqual(principal.roleSlugs, ["crm_administrator", "sales_representative"]);
  assert.deepEqual(principal.permissions, ["crm.leads.manage", "crm.view"]);
  assert.deepEqual(principal.companyScope, { unrestricted: false, resolved: true, companyIds: ["c-1", "c-2"], branchIds: ["b-1"] });
  assert.equal(principal.assurance.mfaSatisfied, true);
  assert.equal("email" in principal, false, "identity PII is not part of the security principal");
  assert.ok(Object.isFrozen(principal) && Object.isFrozen(principal.permissions) && Object.isFrozen(principal.companyScope));
});

test("principal construction fails closed without a user or an organization workspace", () => {
  assert.throws(() => createAccessPrincipal(null), (error) => error instanceof AccessDeniedError && error.code === "AUTH_REQUIRED" && error.status === 401);
  assert.throws(() => createAccessPrincipal(session({ organizationId: null })), { code: ACCESS_ERROR_CODES.MEMBERSHIP_INACTIVE });
  assert.throws(() => createAccessPrincipal(session({ organizationId: "not-a-uuid" })), { code: ACCESS_ERROR_CODES.MEMBERSHIP_INACTIVE });
});

test("MFA assurance is unsatisfied for an enrolled or policy-required but unverified session", () => {
  assert.equal(createAccessPrincipal(session({ mfaEnrolled: true })).assurance.mfaSatisfied, false);
  assert.equal(createAccessPrincipal(session({ mfaPolicyRequired: true })).assurance.mfaSatisfied, false);
  assert.equal(createAccessPrincipal(session({ mfaEnrolled: true, mfaVerified: true })).assurance.mfaSatisfied, true);
});

test("roles combine: the permission union is the set of every role's grants", () => {
  const union = permissionUnion([
    { permissions: ["crm.view", "crm.leads.manage"] },
    { permissions: ["crm.view", "sales.view"] },
    { permissions: [] },
  ]);
  assert.deepEqual(union, ["crm.leads.manage", "crm.view", "sales.view"]);
});

test("only organization_owner bypasses permission checks; system_administrator gets unrestricted scope, not a bypass", () => {
  const owner = createAccessPrincipal(session({ roleSlugs: ["organization_owner"], permissions: [] }));
  assert.equal(principalHasPermission(owner, "accounting.journal.approve"), true);
  assert.equal(owner.companyScope.unrestricted, true);

  const admin = createAccessPrincipal(session({ roleSlugs: ["system_administrator"], permissions: ["users.manage"] }));
  assert.equal(admin.companyScope.unrestricted, true);
  assert.equal(principalHasPermission(admin, "users.manage"), true);
  assert.equal(principalHasPermission(admin, "accounting.journal.approve"), false);

  const rep = createAccessPrincipal(session());
  assert.equal(principalHasPermission(rep, "crm.view"), true);
  assert.equal(principalHasPermission(rep, "crm.settings.manage"), false);
});

test("a client-supplied tenant identity can never override the session tenant", () => {
  const principal = createAccessPrincipal(session());
  assert.doesNotThrow(() => assertNoClientTenantOverride({ name: "x" }, principal));
  assert.doesNotThrow(() => assertNoClientTenantOverride({ organizationId: ORG }, principal));
  for (const key of ["organizationId", "organization_id", "orgId", "tenantId", "tenant_id"]) {
    assert.throws(() => assertNoClientTenantOverride({ [key]: OTHER_ORG }, principal), { code: "SCOPE_DENIED" }, key);
  }
  assert.throws(() => assertNoClientTenantOverride(new URLSearchParams({ organizationId: OTHER_ORG }), principal), { code: "SCOPE_DENIED" });

  const cleaned = withoutClientTenantIdentity({ organizationId: OTHER_ORG, tenant_id: OTHER_ORG, name: "Lead" });
  assert.deepEqual(cleaned, { name: "Lead" });
  // The domain context is derived from the principal, never from the payload.
  assert.equal(principalToDomainContext(principal).organizationId, ORG);
});
