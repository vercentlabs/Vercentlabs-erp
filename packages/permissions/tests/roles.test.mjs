import assert from "node:assert/strict";
import test from "node:test";

import {
  ROLE_TEMPLATES,
  ROLE_TEMPLATE_BY_SLUG,
  SOD_CONFLICTS,
  analyzePermissionConflicts,
  permissionsOutsideGrantCeiling,
  roleIsAvailable,
  ALL_PERMISSIONS,
} from "../src/index.js";

test("every role template's permissions exist in the canonical ALL_PERMISSIONS catalogue", () => {
  const known = new Set(ALL_PERMISSIONS);
  for (const role of ROLE_TEMPLATES) {
    assert.equal(new Set(role.permissions).size, role.permissions.length, `${role.slug} has duplicate permissions`);
    for (const permission of role.permissions) {
      assert.ok(known.has(permission), `${role.slug} references unknown permission ${permission}`);
    }
  }
});

test("only organization_owner is unassignable; every other template is assignable", () => {
  assert.equal(ROLE_TEMPLATE_BY_SLUG.get("organization_owner").assignable, false);
  for (const role of ROLE_TEMPLATES) {
    if (role.slug === "organization_owner") continue;
    assert.equal(role.assignable, true, `${role.slug} should be assignable`);
  }
});

test("financial separation of duties holds by default across the built-in templates", () => {
  const accountant = ROLE_TEMPLATE_BY_SLUG.get("accountant").permissions;
  assert.ok(accountant.includes("accounting.journal.create"));
  assert.ok(!accountant.includes("accounting.journal.approve"));
  const financeManager = ROLE_TEMPLATE_BY_SLUG.get("finance_manager").permissions;
  assert.ok(financeManager.includes("accounting.journal.approve"));
  assert.ok(!financeManager.includes("accounting.journal.create"));
});

test("analyzePermissionConflicts flags blocking journal/payment prepare+approve combinations", () => {
  const conflicts = analyzePermissionConflicts([
    "accounting.journal.create",
    "accounting.journal.approve",
    "accounting.payments.manage",
    "accounting.payments.approve",
  ]);
  const blockingKeys = conflicts.filter((c) => c.severity === "blocking").map((c) => c.key).sort();
  assert.deepEqual(blockingKeys, ["journal_prepare_approve", "payment_prepare_approve"]);
});

test("no built-in non-privileged role template carries a blocking SoD conflict", () => {
  for (const role of ROLE_TEMPLATES) {
    if (["organization_owner", "system_administrator", "company_administrator"].includes(role.slug)) continue;
    const blocking = analyzePermissionConflicts(role.permissions).filter((c) => c.severity === "blocking");
    assert.equal(blocking.length, 0, `${role.slug} has a blocking SoD conflict: ${blocking.map((c) => c.key).join(",")}`);
  }
});

test("permissionsOutsideGrantCeiling denies granting permissions the actor doesn't hold, except for organization_owner", () => {
  assert.deepEqual(
    permissionsOutsideGrantCeiling(["sales_manager"], ["crm.view", "sales.view"], ["crm.view", "accounting.journal.post"]),
    ["accounting.journal.post"],
  );
  assert.deepEqual(permissionsOutsideGrantCeiling(["organization_owner"], [], ["accounting.journal.post"]), []);
});

test("roleIsAvailable requires assignable=true and (platform scope OR the module being enabled)", () => {
  assert.equal(roleIsAvailable("crm", true, ["crm", "sales"]), true);
  assert.equal(roleIsAvailable("stock", false, ["stock"]), false);
  assert.equal(roleIsAvailable("stock", true, ["crm"]), false);
  assert.equal(roleIsAvailable("platform", true, []), true);
  assert.equal(roleIsAvailable(null, true, []), true);
});

test("SOD_CONFLICTS entries reference real permission keys", () => {
  const known = new Set(ALL_PERMISSIONS);
  for (const conflict of SOD_CONFLICTS) {
    assert.ok(known.has(conflict.first), `${conflict.key}: unknown permission ${conflict.first}`);
    assert.ok(known.has(conflict.second), `${conflict.key}: unknown permission ${conflict.second}`);
  }
});
