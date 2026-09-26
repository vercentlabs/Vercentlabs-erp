import assert from "node:assert/strict";
import test from "node:test";

import { hasSessionPermission, requireSessionPermission, PermissionDeniedError, PERMISSIONS } from "../src/core/access/control-runtime.js";

test("hasSessionPermission grants organization_owner everything regardless of permissions array", () => {
  assert.equal(hasSessionPermission({ roleSlugs: ["organization_owner"], permissions: [] }, "anything.manage"), true);
});

test("hasSessionPermission checks the explicit permissions array for non-owners", () => {
  const session = { roleSlugs: ["employee"], permissions: ["crm.view"] };
  assert.equal(hasSessionPermission(session, "crm.view"), true);
  assert.equal(hasSessionPermission(session, "crm.leads.manage"), false);
});

test("hasSessionPermission fails closed for a null/undefined session", () => {
  assert.equal(hasSessionPermission(null, "crm.view"), false);
  assert.equal(hasSessionPermission(undefined, "crm.view"), false);
});

test("requireSessionPermission throws PermissionDeniedError (403) when denied", () => {
  assert.throws(
    () => requireSessionPermission({ roleSlugs: [], permissions: [] }, "roles.assign"),
    (error) => error instanceof PermissionDeniedError && error.status === 403 && error.code === "PERMISSION_DENIED",
  );
});

test("PERMISSIONS re-exports the live packages/permissions CORE_PERMISSIONS catalogue", () => {
  assert.equal(PERMISSIONS.rolesAssign, "roles.assign");
  assert.equal(PERMISSIONS.usersManage, "users.manage");
});
