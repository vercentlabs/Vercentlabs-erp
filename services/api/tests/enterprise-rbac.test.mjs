// Rewritten for Prompt 2 of 15 (platform reactivation port). The previous
// version of this test (still readable at docs/frontend-rebuild/
// the recovered pre-rebuild snapshot (last present at commit d4df5eb1), apps/web/tests/enterprise-rbac.test.mjs, now
// retired) transpiled and ran the PARKED access-control.ts snapshot — a
// preservation check, not evidence RBAC worked in production, since that
// snapshot was never wired into any active build.
//
// This version exercises the LIVE code the parked snapshot was ported
// into: packages/permissions/src/roles.js (role templates, SoD policy)
// and services/api/src/core/access/administration-service.js (delegated-admin
// scope containment, grant-ceiling enforcement). See
// docs/frontend-rebuild/PLATFORM_PORT_REGISTER.csv for the full mapping.
// Deeper per-symbol coverage of each already lives in
// packages/permissions/tests/roles.test.mjs and services/api/tests/
// platform-access-administration.test.mjs — this file focuses on the
// cross-cutting invariants the original test was specifically guarding.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ROLE_TEMPLATES,
  ROLE_TEMPLATE_BY_SLUG,
  ALL_PERMISSIONS,
} from "@vercentlabs/permissions";
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";
import {
  hasUnrestrictedAccessAdministration,
  AccessAdministrationError,
  assertUserWithinAdministrationScope,
} from "../src/core/access/administration-service.js";

const assignableRoleSlugs = [
  "system_administrator", "company_administrator", "employee", "auditor", "read_only",
  "crm_administrator", "sales_head", "sales_manager", "sales_representative", "sales_operations",
  "marketing_manager", "customer_success_manager", "partner_manager", "finance_manager",
  "accountant", "accounts_receivable_executive", "accounts_payable_executive", "treasury_executive",
  "tax_compliance_accountant", "purchase_manager", "buyer", "purchase_requester", "purchase_approver",
  "goods_receipt_user", "supplier_manager", "inventory_manager", "manufacturing_manager",
  "project_manager", "asset_manager", "pos_manager", "pos_cashier", "pos_supervisor", "quality_manager", "support_manager", "hr_manager",
];

test("role catalogue is complete, module-aware, and every module has at least one assignable role", () => {
  assert.equal(ROLE_TEMPLATES.length, 36);
  const releasedModuleKeys = new Set(["platform", ...ERP_MODULE_CATALOG.map((m) => m.key)]);
  for (const slug of assignableRoleSlugs) {
    const role = ROLE_TEMPLATE_BY_SLUG.get(slug);
    assert.ok(role, `Missing role template ${slug}`);
    assert.equal(role.assignable, true, `${slug} must be assignable`);
    assert.ok(releasedModuleKeys.has(role.moduleKey), `${slug} references unknown module ${role.moduleKey}`);
  }
  assert.equal(ROLE_TEMPLATE_BY_SLUG.get("organization_owner").assignable, false);
  for (const module of ERP_MODULE_CATALOG) {
    const hasAssignableRole = ROLE_TEMPLATES.some((role) => role.moduleKey === module.key && role.assignable);
    assert.ok(hasAssignableRole, `${module.key} has no assignable operational role`);
  }
});

test("every role's permissions exist in the live ALL_PERMISSIONS catalogue (no drift)", () => {
  const known = new Set(ALL_PERMISSIONS);
  for (const role of ROLE_TEMPLATES) {
    for (const permission of role.permissions) {
      assert.ok(known.has(permission), `${role.slug} references unknown permission ${permission}`);
    }
  }
});

test("hasUnrestrictedAccessAdministration is exactly organization_owner and system_administrator", () => {
  assert.equal(hasUnrestrictedAccessAdministration(["organization_owner"]), true);
  assert.equal(hasUnrestrictedAccessAdministration(["system_administrator"]), true);
  for (const role of ROLE_TEMPLATES) {
    if (["organization_owner", "system_administrator"].includes(role.slug)) continue;
    assert.equal(
      hasUnrestrictedAccessAdministration([role.slug]),
      false,
      `${role.slug} must NOT have unrestricted access administration`,
    );
  }
});

test("delegated administrators cannot manage a user with access outside their own company/branch/department/team scope", async () => {
  const client = {
    query: async () => ({
      rows: [
        {
          has_company_scope: true,
          companies_within_scope: false, // the target has a company the actor does not
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
      actorUserId: "delegated-admin",
      actorRoleSlugs: ["company_administrator"],
      targetUserId: "target-user",
    }),
    (error) => error instanceof AccessAdministrationError && error.status === 403,
  );
});

test("mobile app's live access-manager component still expects the same role-assignment contract (roleIds/primaryRoleId)", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const mobileUi = fs.readFileSync(path.join(root, "apps/mobile/src/shared/components/access-manager.tsx"), "utf8");
  assert.ok(mobileUi.includes("roleIds"));
  assert.ok(mobileUi.includes("primaryRoleId"));
});
