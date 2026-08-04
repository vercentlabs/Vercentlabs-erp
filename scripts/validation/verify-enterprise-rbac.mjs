import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "database/control-plane/migrations/018_enterprise_roles_permissions.sql",
  "apps/web/src/lib/access-control.ts",
  "apps/web/src/lib/access-administration.ts",
  "apps/web/src/app/api/users/[userId]/route.ts",
  "apps/web/src/app/api/roles/route.ts",
  "apps/web/src/app/api/roles/[id]/route.ts",
  "apps/web/src/app/api/invitations/route.ts",
  "apps/web/src/app/api/invitations/accept/route.ts",
  "apps/web/src/components/user-administration.tsx",
  "apps/web/src/components/role-manager.tsx",
  "apps/mobile/src/shared/components/access-manager.tsx",
  "apps/web/tests/enterprise-rbac.test.mjs",
  "apps/web/scripts/verify-enterprise-rbac-live.mjs",
  "docs/architecture/enterprise-rbac.md",
];
for (const file of required) {
  assert.ok(
    fs.existsSync(path.join(root, file)),
    `Missing enterprise RBAC file: ${file}`,
  );
}

const migration = fs.readFileSync(required[0], "utf8");
const roleTemplateSource = fs.readFileSync(required[1], "utf8");
const userRoute = fs.readFileSync(required[3], "utf8");
const roleRoute = fs.readFileSync(required[4], "utf8");
const roleUpdateRoute = fs.readFileSync(required[5], "utf8");

assert.match(
  migration,
  /CREATE UNIQUE INDEX IF NOT EXISTS user_role_assignments_one_primary_idx/,
);
assert.match(migration, /CREATE TABLE IF NOT EXISTS role_version_snapshots/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS access_assignment_events/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS access_conflict_rules/);
assert.match(migration, /DELETE FROM role_permissions[\s\S]+r\.is_system=true/);
assert.match(migration, /enterprise_rbac_migrated/);
assert.match(roleTemplateSource, /name: "Sales Representative"/);
assert.match(roleTemplateSource, /name: "Accounts Receivable Executive"/);
assert.match(roleTemplateSource, /name: "Buyer \/ Purchase Officer"/);
assert.match(roleTemplateSource, /assignable: false,[\s\S]{0,120}permissions:/);
assert.match(userRoute, /validateRoleSelection/);
assert.match(userRoute, /validateScopeGrantCeiling/);
assert.match(userRoute, /access_assignment_events/);
assert.match(roleRoute, /permissionsOutsideGrantCeiling/);
assert.match(roleRoute, /analyzePermissionConflicts/);
assert.match(roleUpdateRoute, /role_permissions_changed/);

const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
assert.ok(
  packageJson.scripts?.["verify:enterprise-rbac"],
  "Root verify:enterprise-rbac command is missing",
);
assert.ok(
  packageJson.scripts?.["test:enterprise-rbac-live"],
  "Root test:enterprise-rbac-live command is missing",
);

console.log("Enterprise RBAC static contract verified.");
