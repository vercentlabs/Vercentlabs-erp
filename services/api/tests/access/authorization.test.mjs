import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCESS_ERROR_CODES,
  AccessDeniedError,
  accessLogFields,
  assembleWorkspaceAccessSnapshot,
  assertNoBlockingSodConflict,
  assertWritableFields,
  authorize,
  buildWorkspaceAccessSnapshot,
  canonicalAccessCode,
  createAccessPrincipal,
  logAccessDenial,
  projectFields,
  requireAuthorization,
} from "../../src/core/access/index.js";
import { getAccessibleModules } from "../../src/core/access/module-entitlements.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const COMPANY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BRANCH_A1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const BRANCH_B1 = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";

const baseSession = {
  userId: "u-1",
  organizationId: ORG,
  roleSlugs: ["crm_user"],
  permissions: ["crm.view", "crm.leads.manage"],
  activeCompanyId: COMPANY_A,
  activeBranchId: BRANCH_A1,
  emailVerified: true,
};

const billing = (modules, enforcementMode = "enforce") => ({ status: "active", planCode: "growth", modules, enforcementMode, writeAccess: true, seats: null, seatOverage: null });

function snapshot({ session = baseSession, enabled = ["crm", "sales"], plan = billing(["crm", "sales"]), companies } = {}) {
  return assembleWorkspaceAccessSnapshot({
    session,
    enabledModuleKeys: enabled === null ? null : new Set(enabled),
    billingSummary: plan,
    companies: companies ?? [{ id: COMPANY_A, name: "A", branches: [{ id: BRANCH_A1, company_id: COMPANY_A, name: "A1" }] }],
    now: new Date("2026-09-25T00:00:00Z"),
  });
}

test("snapshot resolves module state, subscription and scope once, frozen and dated", () => {
  const snap = snapshot();
  assert.deepEqual(snap.accessibleModules, ["crm"]);
  assert.deepEqual([...snap.enabledModules].sort(), ["crm", "sales"]);
  assert.deepEqual([...snap.entitledModules].sort(), ["crm", "sales"]);
  assert.deepEqual(snap.principal.companyScope.companyIds, [COMPANY_A]);
  assert.deepEqual(snap.branches, [{ id: BRANCH_A1, name: "A1", companyId: COMPANY_A }]);
  assert.equal(snap.subscription.planCode, "growth");
  assert.equal(snap.generatedAt, "2026-09-25T00:00:00.000Z");
  assert.equal(snap.modules.length, 12);
  assert.ok(Object.isFrozen(snap) && Object.isFrozen(snap.modules));
});

test("module access: disabled, not entitled, missing permission and unknown modules are denied with stable codes", () => {
  assert.equal(authorize({ snapshot: snapshot({ enabled: ["sales"] }), module: "crm" }).code, ACCESS_ERROR_CODES.MODULE_DISABLED);
  assert.equal(authorize({ snapshot: snapshot({ plan: billing(["sales"]) }), module: "crm" }).code, ACCESS_ERROR_CODES.MODULE_NOT_ENTITLED);
  const denied = authorize({ snapshot: snapshot(), module: "sales" });
  assert.equal(denied.code, ACCESS_ERROR_CODES.PERMISSION_DENIED);
  assert.equal(denied.permission, "sales.view");
  assert.equal(authorize({ snapshot: snapshot(), module: "not-a-module" }).code, ACCESS_ERROR_CODES.MODULE_UNAVAILABLE);
  assert.equal(authorize({ snapshot: snapshot(), module: "not-a-module" }).status, 404);
});

test("module access: observe-mode billing never blocks, but failed lookups fail closed", () => {
  assert.equal(authorize({ snapshot: snapshot({ plan: billing(["sales"], "observe") }), module: "crm" }).allowed, true);
  assert.equal(authorize({ snapshot: snapshot({ plan: null }), module: "crm" }).code, ACCESS_ERROR_CODES.MODULE_NOT_ENTITLED);
  assert.equal(authorize({ snapshot: snapshot({ enabled: null }), module: "crm" }).code, ACCESS_ERROR_CODES.MODULE_DISABLED);
});

test("module access: the allowed path succeeds and returns the principal", () => {
  const snap = snapshot();
  const decision = authorize({ snapshot: snap, module: "crm", permission: "crm.leads.manage", action: "crm.lead.update" });
  assert.equal(decision.allowed, true);
  assert.equal(decision.principal, snap.principal);
  assert.equal(requireAuthorization({ snapshot: snap, module: "crm" }), snap.principal);
});

test("authentication, MFA and membership are checked before anything else", () => {
  assert.equal(authorize({}).code, ACCESS_ERROR_CODES.AUTH_REQUIRED);
  const mfaPending = snapshot({ session: { ...baseSession, mfaEnrolled: true, mfaVerified: false } });
  assert.equal(authorize({ snapshot: mfaPending, module: "crm" }).code, ACCESS_ERROR_CODES.AUTH_MFA_REQUIRED);
  assert.throws(() => snapshot({ session: { ...baseSession, organizationId: null } }), { code: "MEMBERSHIP_INACTIVE" });
});

test("permission checks require every listed permission", () => {
  const snap = snapshot();
  assert.equal(authorize({ snapshot: snap, permissions: ["crm.view", "crm.settings.manage"] }).permission, "crm.settings.manage");
  assert.throws(() => requireAuthorization({ snapshot: snap, permission: "crm.settings.manage" }), (error) =>
    error instanceof AccessDeniedError && error.code === "PERMISSION_DENIED" && error.status === 403);
});

test("scope: a resource from another organization is denied and concealed as not found", () => {
  const decision = authorize({ snapshot: snapshot(), resource: { organizationId: OTHER_ORG } });
  assert.equal(decision.code, ACCESS_ERROR_CODES.SCOPE_DENIED);
  assert.equal(decision.status, 404);
  assert.throws(() => requireAuthorization({ snapshot: snapshot(), resource: { organizationId: OTHER_ORG } }), (error) =>
    error.code === "RESOURCE_NOT_FOUND" && error.deniedCode === "SCOPE_DENIED" && error.status === 404);
});

test("scope: company and branch outside the principal's grants are denied", () => {
  const snap = snapshot();
  assert.equal(authorize({ snapshot: snap, context: { companyId: COMPANY_B } }).code, ACCESS_ERROR_CODES.SCOPE_DENIED);
  assert.equal(authorize({ snapshot: snap, context: { companyId: COMPANY_B } }).status, 403, "context scope is not concealed");
  assert.equal(authorize({ snapshot: snap, context: { companyId: COMPANY_A, branchId: BRANCH_B1 } }).reason, "branch");
  assert.equal(authorize({ snapshot: snap, resource: { organizationId: ORG, companyId: COMPANY_A, branchId: BRANCH_A1 } }).allowed, true);
});

test("scope: a granted branch paired with the wrong company is denied", () => {
  const snap = snapshot({
    companies: [
      { id: COMPANY_A, branches: [{ id: BRANCH_A1, company_id: COMPANY_A }] },
      { id: COMPANY_B, branches: [{ id: BRANCH_B1, company_id: COMPANY_B }] },
    ],
  });
  assert.equal(authorize({ snapshot: snap, context: { companyId: COMPANY_A, branchId: BRANCH_B1 } }).code, "SCOPE_DENIED");
});

test("scope: unrestricted roles pass company scope; scope checks without a resolved snapshot are a programming error", () => {
  const owner = snapshot({ session: { ...baseSession, roleSlugs: ["organization_owner"] }, companies: [] });
  assert.equal(authorize({ snapshot: owner, context: { companyId: COMPANY_B } }).allowed, true);
  const bare = createAccessPrincipal(baseSession);
  assert.throws(() => authorize({ principal: bare, context: { companyId: COMPANY_A } }), TypeError);
  assert.throws(() => authorize({ principal: bare, module: "crm" }), TypeError);
});

test("domain record policies run last and can deny with their own code", () => {
  const snap = snapshot();
  const ownerOnly = ({ principal, resource }) => (resource.ownerUserId === principal.userId ? null : { code: "SCOPE_DENIED", reason: "crm_owner" });
  assert.equal(authorize({ snapshot: snap, resource: { organizationId: ORG, ownerUserId: "u-1" }, recordPolicy: ownerOnly }).allowed, true);
  const denied = authorize({ snapshot: snap, resource: { organizationId: ORG, ownerUserId: "u-2" }, recordPolicy: ownerOnly });
  assert.equal(denied.reason, "crm_owner");
  assert.equal(denied.status, 404);
});

test("field access projects sensitive fields away and rejects writes to them", () => {
  const principal = createAccessPrincipal(baseSession);
  const rules = [{ permission: "hr_payroll.sensitive.view", fields: ["bankAccount", "pan"] }];
  assert.deepEqual(projectFields(principal, { name: "A", pan: "X", bankAccount: "Y" }, rules), { name: "A" });
  assert.deepEqual(projectFields(principal, [{ name: "A", pan: "X" }], rules), [{ name: "A" }]);
  assert.throws(() => assertWritableFields(principal, { pan: "X" }, rules), { code: "FIELD_ACCESS_DENIED" });
  assert.doesNotThrow(() => assertWritableFields(principal, { name: "A" }, rules));
  const hr = createAccessPrincipal({ ...baseSession, permissions: ["hr_payroll.sensitive.view"] });
  assert.deepEqual(projectFields(hr, { name: "A", pan: "X" }, rules), { name: "A", pan: "X" });
});

test("blocking separation-of-duties conflicts produce SOD_CONFLICT", () => {
  assert.throws(() => assertNoBlockingSodConflict(["accounting.journal.create", "accounting.journal.approve"]), { code: "SOD_CONFLICT", status: 409 });
  assert.equal(assertNoBlockingSodConflict(["sales.quotation.create", "sales.quotation.approve"]).length, 1, "warnings are returned, not thrown");
});

test("legacy codes map onto the canonical vocabulary", () => {
  assert.equal(canonicalAccessCode("MODULE_NOT_PERMITTED"), "PERMISSION_DENIED");
  assert.equal(canonicalAccessCode("COMPANY_ACCESS_DENIED"), "SCOPE_DENIED");
  assert.equal(canonicalAccessCode("MODULE_DISABLED"), "MODULE_DISABLED");
  assert.equal(canonicalAccessCode("SOMETHING_ELSE"), null);
});

test("denial log fields carry request/actor/module/action context and never session secrets", () => {
  const snap = snapshot();
  const decision = authorize({ snapshot: snap, module: "sales", action: "sales.order.create" });
  const fields = accessLogFields(decision, snap.principal, { requestId: "req-1" });
  assert.deepEqual(fields, {
    requestId: "req-1",
    correlationId: "req-1",
    organizationId: ORG,
    userId: "u-1",
    module: "sales",
    action: "sales.order.create",
    permission: "sales.view",
    allowed: false,
    code: "PERMISSION_DENIED",
    reason: "not_permitted",
  });
  const lines = [];
  logAccessDenial(decision, { ...snap.principal, token: "secret-session-token" }, { requestId: "req-1" }, { warn: (message, extra) => lines.push({ message, extra }) });
  assert.equal(lines[0].message, "access.denied");
  assert.equal(JSON.stringify(lines).includes("secret-session-token"), false);
});

test("buildWorkspaceAccessSnapshot fails closed on lookup errors and agrees with getAccessibleModules", async () => {
  const broken = { query: async () => { throw new Error("db down"); } };
  const snap = await buildWorkspaceAccessSnapshot(broken, baseSession, { env: { NODE_ENV: "test" } });
  assert.deepEqual(snap.accessibleModules, []);
  assert.deepEqual(snap.companies, []);

  const client = {
    query: async (sql) => {
      if (/organization_modules/.test(sql)) return { rows: [{ module_key: "crm" }, { module_key: "sales" }] };
      if (/organization_subscriptions/.test(sql)) {
        return { rows: [{ status: "active", plan_code: "growth", plan_name: "Growth", billing_period: "monthly", modules_snapshot: ["crm"], limits_snapshot: {}, cancel_at_cycle_end: false }] };
      }
      if (/FROM companies/.test(sql)) return { rows: [{ id: COMPANY_A, name: "A" }] };
      if (/FROM branches/.test(sql)) return { rows: [{ id: BRANCH_A1, company_id: COMPANY_A, name: "A1" }] };
      return { rows: [] };
    },
  };
  const env = { NODE_ENV: "production", BILLING_ENFORCEMENT_MODE: "enforce" };
  const built = await buildWorkspaceAccessSnapshot(client, baseSession, { env });
  const legacy = await getAccessibleModules(client, baseSession, env);
  assert.deepEqual(built.modules.map((entry) => ({ ...entry })), legacy);
  assert.deepEqual(built.accessibleModules, ["crm"]);
  assert.deepEqual(built.branches.map((branch) => branch.id), [BRANCH_A1]);
});
