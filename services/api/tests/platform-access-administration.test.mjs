import assert from "node:assert/strict";
import test from "node:test";

import {
  AccessAdministrationError,
  hasUnrestrictedAccessAdministration,
  validateRoleSelection,
  assertUserWithinAdministrationScope,
} from "../src/core/access-administration.js";

test("hasUnrestrictedAccessAdministration recognizes only owner/system_administrator as unrestricted", () => {
  assert.equal(hasUnrestrictedAccessAdministration(["organization_owner"]), true);
  assert.equal(hasUnrestrictedAccessAdministration(["system_administrator"]), true);
  assert.equal(hasUnrestrictedAccessAdministration(["company_administrator"]), false);
  assert.equal(hasUnrestrictedAccessAdministration(["employee"]), false);
});

test("validateRoleSelection rejects granting a permission the actor does not hold (grant-ceiling enforcement)", async () => {
  const client = {
    query: async () => ({
      rows: [
        {
          id: "role-1",
          slug: "finance_manager",
          name: "Finance Manager",
          is_system: false,
          assignable: true,
          module_key: "accounting",
          risk_level: "privileged",
          permission_keys: ["accounting.journal.approve", "accounting.payments.approve"],
        },
      ],
    }),
  };
  await assert.rejects(
    validateRoleSelection(client, {
      organizationId: "org-1",
      roleIds: ["role-1"],
      primaryRoleId: "role-1",
      actor: { roleSlugs: ["employee"], permissions: ["workspace.view"] },
      acknowledgeWarningConflicts: false,
    }),
    (error) => error instanceof AccessAdministrationError && error.status === 403,
  );
});

test("validateRoleSelection blocks a hard separation-of-duties conflict even with acknowledgement", async () => {
  const client = {
    query: async () => ({
      rows: [
        {
          id: "role-1",
          slug: "custom_finance_role",
          name: "Custom Finance Role",
          is_system: false,
          assignable: true,
          module_key: "accounting",
          risk_level: "privileged",
          permission_keys: ["accounting.journal.create", "accounting.journal.approve"],
        },
      ],
    }),
  };
  await assert.rejects(
    validateRoleSelection(client, {
      organizationId: "org-1",
      roleIds: ["role-1"],
      primaryRoleId: "role-1",
      actor: { roleSlugs: ["organization_owner"], permissions: [] },
      acknowledgeWarningConflicts: true,
    }),
    (error) => error instanceof AccessAdministrationError && error.status === 409,
  );
});

test("validateRoleSelection blocks assigning organization_owner outside the controlled transfer flow", async () => {
  const client = {
    query: async () => ({
      rows: [
        {
          id: "owner-role",
          slug: "organization_owner",
          name: "Organisation Owner",
          is_system: true,
          assignable: false,
          module_key: "platform",
          risk_level: "privileged",
          permission_keys: [],
        },
      ],
    }),
  };
  await assert.rejects(
    validateRoleSelection(client, {
      organizationId: "org-1",
      roleIds: ["owner-role"],
      primaryRoleId: "owner-role",
      actor: { roleSlugs: ["organization_owner"], permissions: [] },
      acknowledgeWarningConflicts: false,
      allowOwnerRole: false,
    }),
    (error) => error instanceof AccessAdministrationError && error.status === 403,
  );
});

test("assertUserWithinAdministrationScope fails closed when a scoped admin's target has zero recorded company scope", async () => {
  const client = {
    query: async () => ({
      rows: [
        {
          has_company_scope: false,
          companies_within_scope: true,
          branches_within_scope: true,
          departments_within_scope: true,
          teams_within_scope: true,
        },
      ],
    }),
  };
  await assert.rejects(
    assertUserWithinAdministrationScope(client, {
      organizationId: "org-1",
      actorUserId: "actor-1",
      actorRoleSlugs: ["company_administrator"],
      targetUserId: "target-1",
    }),
    (error) => error instanceof AccessAdministrationError && error.status === 403,
  );
});

test("assertUserWithinAdministrationScope is a no-op for unrestricted administrators (never queries scope)", async () => {
  let called = false;
  const client = { query: async () => { called = true; return { rows: [] }; } };
  await assertUserWithinAdministrationScope(client, {
    organizationId: "org-1",
    actorUserId: "actor-1",
    actorRoleSlugs: ["organization_owner"],
    targetUserId: "target-1",
  });
  assert.equal(called, false);
});
