import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const webRoot = process.cwd();
const root = path.resolve(webRoot, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

async function loadAccessControl() {
  const sourcePath = path.join(webRoot, "src/core/access-control.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const permissionsUrl = pathToFileURL(
    path.join(root, "packages/permissions/src/index.js"),
  ).href;
  const transpiled = ts
    .transpileModule(source, {
      fileName: sourcePath,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    })
    .outputText.replace(
      'from "@vercentlabs/permissions"',
      `from ${JSON.stringify(permissionsUrl)}`,
    );
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "vercent-rbac-"),
  );
  const temporaryFile = path.join(temporaryDirectory, "access-control.mjs");
  fs.writeFileSync(temporaryFile, transpiled);
  return import(`${pathToFileURL(temporaryFile).href}?v=${Date.now()}`);
}

const accessControl = await loadAccessControl();
const permissions = await import(
  pathToFileURL(path.join(root, "packages/permissions/src/index.js")).href
);

const templates = accessControl.ROLE_TEMPLATES;
const templateBySlug = new Map(templates.map((role) => [role.slug, role]));

// As of Prompt 4 (docs/implementation/ERP_AUTHORIZATION_MODEL_004.md), every
// one of the 12 business modules in packages/shared-types/src/modules.js's
// ERP_MODULE_CATALOG (all availability: "released") has a real, assignable
// operational role — closing the inconsistency this test previously
// tracked deliberately: Stock/Manufacturing/HR & Payroll used to carry
// unassignable "future" roles, and Projects/Assets/Point of Sale/Quality
// had no role at all. Only organization_owner remains unassignable (it is
// granted automatically at organisation creation, never picked from the
// role-management UI — see access-control.ts's roleIsAvailable()).
const assignableRoleSlugs = [
  "system_administrator",
  "company_administrator",
  "employee",
  "auditor",
  "read_only",
  "crm_administrator",
  "sales_head",
  "sales_manager",
  "sales_representative",
  "sales_operations",
  "marketing_manager",
  "customer_success_manager",
  "partner_manager",
  "finance_manager",
  "accountant",
  "accounts_receivable_executive",
  "accounts_payable_executive",
  "treasury_executive",
  "tax_compliance_accountant",
  "purchase_manager",
  "buyer",
  "purchase_requester",
  "purchase_approver",
  "goods_receipt_user",
  "supplier_manager",
  "inventory_manager",
  "manufacturing_manager",
  "project_manager",
  "asset_manager",
  "pos_manager",
  "quality_manager",
  "support_manager",
  "hr_manager",
];

// Every business-module key a role can be scoped to must appear in
// ERP_MODULE_CATALOG (imported directly, not hand-copied, so this can't
// itself drift) — see tests/security/module-access.test.mjs for the
// reverse direction (every catalogue module has at least one assignable
// role).
const releasedModuleKeys = new Set([
  "platform",
  ...(
    await import(
      pathToFileURL(path.join(root, "packages/shared-types/src/index.js")).href
    )
  ).ERP_MODULE_CATALOG.map((module) => module.key),
]);

test("role catalogue is complete and module-aware", () => {
  assert.equal(templates.length, 34);
  assert.equal(
    new Set(templates.map((role) => role.slug)).size,
    templates.length,
  );
  for (const slug of assignableRoleSlugs) {
    const role = templateBySlug.get(slug);
    assert.ok(role, `Missing role template ${slug}`);
    assert.equal(role.assignable, true, `${slug} must be assignable`);
    assert.ok(
      releasedModuleKeys.has(role.moduleKey),
      `${slug} references unknown module ${role.moduleKey}`,
    );
  }
  assert.equal(templateBySlug.get("organization_owner").assignable, false);
});

test("every role permission exists in the canonical permission catalogue", () => {
  const known = new Set(permissions.ALL_PERMISSIONS);
  for (const role of templates) {
    assert.equal(
      new Set(role.permissions).size,
      role.permissions.length,
      `${role.slug} contains duplicate permissions`,
    );
    for (const permission of role.permissions) {
      assert.ok(
        known.has(permission),
        `${role.slug} references unknown ${permission}`,
      );
    }
  }
});

test("basic and audit roles remain least privilege", () => {
  assert.deepEqual(
    [...templateBySlug.get("employee").permissions].sort(),
    [
      "business_data.view",
      "notifications.view",
      "profile.manage",
      "workspace.view",
    ].sort(),
  );
  const auditor = templateBySlug.get("auditor").permissions;
  for (const forbidden of [
    "crm.privacy.manage",
    "users.manage",
    "roles.manage",
    "roles.assign",
    "accounting.journal.post",
    "accounting.payments.manage",
    "procurement.po.manage",
  ]) {
    assert.ok(
      !auditor.includes(forbidden),
      `Auditor must not receive ${forbidden}`,
    );
  }
});

test("financial, sales and procurement duties are separated by default", () => {
  assert.ok(
    templateBySlug
      .get("accountant")
      .permissions.includes("accounting.journal.create"),
  );
  assert.ok(
    !templateBySlug
      .get("accountant")
      .permissions.includes("accounting.journal.approve"),
  );
  assert.ok(
    templateBySlug
      .get("finance_manager")
      .permissions.includes("accounting.journal.approve"),
  );
  assert.ok(
    !templateBySlug
      .get("finance_manager")
      .permissions.includes("accounting.journal.create"),
  );
  assert.ok(
    templateBySlug
      .get("treasury_executive")
      .permissions.includes("accounting.payments.manage"),
  );
  assert.ok(
    !templateBySlug
      .get("treasury_executive")
      .permissions.includes("accounting.payments.approve"),
  );
  assert.ok(
    templateBySlug
      .get("sales_representative")
      .permissions.includes("sales.order.create"),
  );
  assert.ok(
    !templateBySlug
      .get("sales_representative")
      .permissions.includes("sales.order.approve"),
  );
  assert.ok(
    templateBySlug.get("buyer").permissions.includes("procurement.po.create"),
  );
  assert.ok(
    !templateBySlug.get("buyer").permissions.includes("procurement.po.approve"),
  );
});

test("blocking separation-of-duties conflicts are detected", () => {
  const conflicts = accessControl.analyzePermissionConflicts([
    "accounting.journal.create",
    "accounting.journal.approve",
    "accounting.payments.manage",
    "accounting.payments.approve",
  ]);
  assert.deepEqual(
    conflicts
      .filter((entry) => entry.severity === "blocking")
      .map((entry) => entry.key)
      .sort(),
    ["journal_prepare_approve", "payment_prepare_approve"],
  );
  for (const role of templates.filter(
    (role) =>
      ![
        "organization_owner",
        "system_administrator",
        "company_administrator",
      ].includes(role.slug),
  )) {
    const blocking = accessControl
      .analyzePermissionConflicts(role.permissions)
      .filter((entry) => entry.severity === "blocking");
    assert.equal(blocking.length, 0, `${role.slug} has a blocking conflict`);
  }
});

test("grant ceiling and module availability fail closed", () => {
  assert.deepEqual(
    accessControl.permissionsOutsideGrantCeiling(
      ["sales_manager"],
      ["crm.view", "sales.view"],
      ["crm.view", "accounting.journal.post"],
    ),
    ["accounting.journal.post"],
  );
  assert.deepEqual(
    accessControl.permissionsOutsideGrantCeiling(
      ["organization_owner"],
      [],
      ["accounting.journal.post"],
    ),
    [],
  );
  assert.equal(
    accessControl.roleIsAvailable("crm", true, ["crm", "sales"]),
    true,
  );
  assert.equal(accessControl.roleIsAvailable("stock", false, ["stock"]), false);
  assert.equal(accessControl.roleIsAvailable("stock", true, ["crm"]), false);
});

test("database migration establishes multi-role, evidence and SoD contracts", () => {
  const migration = read(
    "database/platform/migrations/018_enterprise_roles_permissions.sql",
  );
  for (const token of [
    "roles.view",
    "roles.assign",
    "access.sod.override",
    "is_primary boolean",
    "starts_at timestamptz",
    "expires_at timestamptz",
    "membership_team_access",
    "organization_invitation_roles",
    "role_version_snapshots",
    "access_assignment_events",
    "access_conflict_rules",
    "user_role_assignments_one_primary_idx",
    "DELETE FROM role_permissions",
    "enterprise_rbac_migrated",
  ]) {
    assert.ok(migration.includes(token), `Migration lacks ${token}`);
  }
  // Historical record: migration 018 itself established these three roles
  // as unassignable — that assertion describes what 018 actually did and
  // must not change. Migration 027 (below) is what corrects the live
  // state for every existing organization.
  assert.match(migration, /Inventory Manager[^\n]+stock[^\n]+false/);
  assert.match(
    migration,
    /Manufacturing Manager[^\n]+manufacturing[^\n]+false/,
  );
  assert.match(migration, /HR Manager[^\n]+hr-payroll[^\n]+false/);
});

test("a later migration corrects role/module assignability for every existing organization", () => {
  const migration = read(
    "database/platform/migrations/027_role_catalogue_module_completion.sql",
  );
  assert.match(migration, /roles_module_key_check/);
  assert.match(migration, /'projects','assets','point-of-sale'/);
  for (const [name, moduleKey] of [
    ["Inventory Manager", "stock"],
    ["Manufacturing Manager", "manufacturing"],
    ["Project Manager", "projects"],
    ["Asset Manager", "assets"],
    ["Point of Sale Manager", "point-of-sale"],
    ["Quality Manager", "quality"],
    ["Support Manager", "support"],
    ["HR Manager", "hr-payroll"],
  ]) {
    const pattern = new RegExp(
      `${name}[^\\n]+${moduleKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]+true`,
    );
    assert.match(migration, pattern, `${name} must be corrected to assignable=true for module ${moduleKey}`);
  }
  assert.match(migration, /FROM organizations o CROSS JOIN template t/);
  assert.match(migration, /ON CONFLICT \(organization_id,slug\) DO UPDATE/);
});

test("web and mobile access administration use cumulative roles and effective dates", () => {
  const userRoute = read("apps/web/src/app/api/users/[userId]/route.ts");
  const invitationRoute = read("apps/web/src/app/api/invitations/route.ts");
  const acceptanceRoute = read(
    "apps/web/src/app/api/invitations/accept/route.ts",
  );
  const auth = read("apps/web/src/core/auth.ts");
  const webUi = read("apps/web/src/core/components/user-administration.tsx");
  const mobileUi = read("apps/mobile/src/shared/components/access-manager.tsx");
  for (const token of [
    "roleIds",
    "primaryRoleId",
    "accessStartsAt",
    "accessExpiresAt",
    "acknowledgeWarningConflicts",
    "membership_team_access",
    "access_assignment_events",
    "Use another administrator to change your own roles",
  ]) {
    assert.ok(userRoute.includes(token), `User route lacks ${token}`);
  }
  assert.ok(invitationRoute.includes("organization_invitation_roles"));
  assert.ok(acceptanceRoute.includes("validateInvitationRolesForAcceptance"));
  assert.ok(auth.includes("assignment.starts_at <= now()"));
  assert.ok(
    auth.includes(
      "assignment.expires_at IS NULL OR assignment.expires_at > now()",
    ),
  );
  for (const source of [webUi, mobileUi]) {
    assert.ok(source.includes("roleIds"));
    assert.ok(source.includes("primaryRoleId"));
  }
});

test("delegated administrators cannot modify users or invitations with wider company scope", () => {
  const administration = read("apps/web/src/core/access-admin.ts");
  assert.match(
    administration,
    /This user has access outside your administration scope/,
  );
  assert.match(
    administration,
    /This invitation has access outside your administration scope/,
  );
  assert.ok(
    administration.includes("AND NOT EXISTS ("),
    "Delegated access administration must use fail-closed subset checks",
  );
  for (const relation of [
    "membership_company_access",
    "membership_branch_access",
    "membership_department_access",
    "membership_team_access",
  ]) {
    assert.ok(
      administration.includes(relation),
      `Scope check lacks ${relation}`,
    );
  }
});

test("role catalogue visibility is separate from role mutation", () => {
  const rolePage = read("apps/web/src/app/(app)/settings/roles/page.tsx");
  // Prompt 6 extracted app-shell.tsx's inline nav arrays into a standalone
  // registry (docs/implementation/ERP_NAVIGATION_FOUNDATION_006.md) — the
  // "/settings/roles" entry now lives in navigation/administration.ts, not
  // app-shell.tsx itself.
  const shell = read("apps/web/src/core/navigation/administration.ts");
  const settings = read("apps/web/src/app/(app)/settings/page.tsx");
  const navigation = read("apps/mobile/src/core/modules/navigation.ts");
  assert.ok(rolePage.includes("PERMISSIONS.rolesView"));
  assert.ok(rolePage.includes("PERMISSIONS.rolesManage"));
  assert.match(
    shell,
    /href: "\/settings\/roles"[\s\S]{0,160}permission: PERMISSIONS\.rolesView/,
  );
  assert.match(
    settings,
    /href: "\/settings\/roles"[\s\S]{0,200}permission: PERMISSIONS\.rolesView/,
  );
  assert.match(
    navigation,
    /key: "roles"[\s\S]{0,200}permission: "roles\.view"/,
  );
});
