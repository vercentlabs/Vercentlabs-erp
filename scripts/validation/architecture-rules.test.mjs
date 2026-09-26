import assert from "node:assert/strict";
import test from "node:test";

import {
  checkAccessBoundaryUse,
  checkApiCoreLayout,
  checkCanonicalDefinitions,
  checkClientTenantIdentity,
  checkCrossFeatureImports,
  checkModuleCatalogueCopies,
  checkPermissionLiterals,
  checkTenantContextSetters,
  checkWebDatabaseAccess,
  checkWebRetiredAliases,
  checkWebTopLevel,
} from "./architecture-rules.mjs";

const file = (path, source) => ({ path, source });

test("the active features/ frontend structure is accepted", () => {
  assert.deepEqual(checkWebTopLevel(["app", "core", "features", "shell", "shared"]), []);
});

test("stale frontend paths are rejected with a pointer to the right home", () => {
  const problems = checkWebTopLevel(["app", "core", "features", "shell", "shared", "components", "lib", "modules"]);
  assert.equal(problems.length, 3);
  assert.match(problems.find((problem) => problem.includes("/modules")), /features\/<module>/);
  assert.match(checkWebTopLevel(["app", "core", "shell", "shared"])[0], /features is missing/);
});

test("retired @/lib, @/components and @/modules aliases are rejected", () => {
  assert.equal(checkWebRetiredAliases([file("apps/web/src/app/page.tsx", 'import { x } from "@/lib/x";')]).length, 1);
  assert.equal(checkWebRetiredAliases([file("apps/web/src/app/page.tsx", 'import { x } from "@/modules/crm/x";')]).length, 1);
  assert.deepEqual(checkWebRetiredAliases([file("apps/web/src/app/page.tsx", 'import { x } from "@/features/crm";')]), []);
});

test("features import each other only through public boundaries", () => {
  assert.equal(checkCrossFeatureImports([file("apps/web/src/features/hr/a.ts", 'import { x } from "@/features/crm/leads/internal";')]).length, 1);
  assert.deepEqual(checkCrossFeatureImports([file("apps/web/src/features/hr/a.ts", 'import { x } from "@/features/crm";')]), []);
  assert.deepEqual(checkCrossFeatureImports([file("apps/web/src/features/crm/a.ts", 'import { x } from "@/features/crm/leads/internal";')]), []);
});

test("new flat services/api/src/core files and unknown domains are rejected", () => {
  const domains = ["access", "auth", "organization", "billing", "platform", "security"].map((name) => ({ name, isDirectory: true }));
  assert.deepEqual(checkApiCoreLayout([...domains, { name: "decimal.js", isDirectory: false }, { name: "decimal.d.ts", isDirectory: false }]), []);
  // Auth primitives moved behind the auth boundary: a flat session.js is new code now.
  assert.match(checkApiCoreLayout([...domains, { name: "session.js", isDirectory: false }])[0], /inside a domain directory/);
  assert.match(checkApiCoreLayout([...domains, { name: "new-auth-helper.js", isDirectory: false }])[0], /inside a domain directory/);
  assert.match(checkApiCoreLayout([...domains, { name: "misc", isDirectory: true }])[0], /not a Shared Platform domain/);
  assert.match(checkApiCoreLayout(domains.filter((entry) => entry.name !== "access"))[0], /access\/ boundary is missing/);
});

test("duplicate auth helpers, role registries and module catalogues are rejected", () => {
  assert.equal(checkCanonicalDefinitions([file("services/api/src/modules/crm/x.js", "export function hasSessionPermission(s, p) { return true; }")]).length, 1);
  assert.equal(checkCanonicalDefinitions([file("apps/web/src/features/crm/roles.ts", "export const ROLE_TEMPLATES = [];")]).length, 1);
  assert.deepEqual(checkCanonicalDefinitions([file("services/api/src/core/oauth.js", "function f() {\n  const authorize = new URL(x);\n}")]), [], "local variables are not definitions");
  assert.deepEqual(checkCanonicalDefinitions([file("services/api/src/core/auth/session.js", "export async function resolveSessionContext() {}")]), []);
  const keys = ["crm", "sales", "accounting", "procurement", "stock", "manufacturing", "projects", "assets", "point-of-sale", "quality", "support", "hr-payroll"];
  const copy = `const MODULES = [${keys.map((key) => `"${key}"`).join(", ")}];`;
  assert.equal(checkModuleCatalogueCopies([file("apps/web/src/features/x/modules.ts", copy)], keys).length, 1);
  assert.deepEqual(checkModuleCatalogueCopies([file("packages/shared-types/src/modules.js", copy)], keys), []);
});

test("raw tenant context and raw web SQL outside approved boundaries are rejected", () => {
  const setter = "await client.query(\"SELECT set_config('app.current_organization_id', $1, true)\", [id]);";
  assert.equal(checkTenantContextSetters([file("services/api/src/modules/sales/x.js", setter)]).length, 1);
  assert.deepEqual(checkTenantContextSetters([file("packages/database/src/index.js", setter)]), []);
  assert.equal(checkWebDatabaseAccess([file("apps/web/src/features/crm/server/x.ts", "await client.query('SELECT 1');")]).length, 1);
  assert.equal(checkWebDatabaseAccess([file("apps/web/src/app/api/x/route.ts", 'import { query } from "@/core/db";')]).length, 1);
  assert.equal(checkWebDatabaseAccess([file("apps/web/src/features/crm/server/x.ts", 'import { Pool } from "pg";')]).length, 1);
  assert.deepEqual(checkWebDatabaseAccess([file("apps/web/src/core/workspace-route.ts", 'import type { PoolClient } from "pg";')]), []);
});

test("unregistered permission strings are rejected", () => {
  const known = ["crm.view", "crm.leads.manage"];
  assert.equal(checkPermissionLiterals([file("services/api/src/modules/crm/x.js", 'requireSessionPermission(session, "crm.leads.delete_everything");')], known).length, 1);
  assert.equal(checkPermissionLiterals([file("apps/web/src/app/api/x/route.ts", 'workspaceRoute(request, { permission: "crm.nope" }, h)')], known).length, 1);
  assert.deepEqual(checkPermissionLiterals([file("apps/web/src/app/api/x/route.ts", 'requireSessionPermission(session, "crm.leads.manage");')], known), []);
});

test("organizationId from JSON, query, path or schema is rejected", () => {
  for (const source of [
    "const org = body.organizationId;",
    'const org = url.searchParams.get("organizationId");',
    "const schema = z.object({ organizationId: z.string().uuid() });",
    "await tenantTransaction(input.organization_id, work);",
  ]) {
    assert.equal(checkClientTenantIdentity([file("apps/web/src/app/api/x/route.ts", source)]).length, 1, source);
  }
  assert.equal(checkClientTenantIdentity([file("apps/web/src/app/api/orgs/[organizationId]/route.ts", "")]).length, 1);
  assert.deepEqual(checkClientTenantIdentity([file("apps/web/src/app/api/x/route.ts", "await tenantTransaction(session.organizationId, work);")]), []);
});

test("the Shared Access boundary cannot be bypassed", () => {
  assert.equal(checkAccessBoundaryUse([file("apps/web/src/app/api/x/route.ts", 'import { x } from "@vercentlabs/api/src/core/auth/session.js";')]).length, 1);
  assert.equal(checkAccessBoundaryUse([file("apps/web/src/app/api/x/route.ts", 'import { x } from "../../../../../services/api/src/index.js";')]).length, 1);
  assert.equal(checkAccessBoundaryUse([file("services/api/src/modules/crm/x.js", 'import { authorize } from "../../core/access/authorization.js";')]).length, 1);
  assert.deepEqual(checkAccessBoundaryUse([file("services/api/src/modules/crm/x.js", 'import { authorize } from "../../core/access/index.js";')]), []);
  assert.equal(checkAccessBoundaryUse([file("apps/web/src/app/api/new/route.ts", "await assertModuleAccessible(client, session, 'crm');")]).length, 1);
  assert.deepEqual(checkAccessBoundaryUse([file("apps/web/src/app/api/new/route.ts", 'import { authorize } from "@vercentlabs/api/access";')]), []);
});

test("Shared Access administration guardrails", async () => {
  const {
    checkAccessStateWriters,
    checkAdminRoutesUseWorkspaceRoute,
    checkCompanyAdministratorTemplate,
    checkInvitationWrites,
    checkRetiredDefinitions,
  } = await import("./architecture-rules.mjs");

  // One canonical writer per access-state table.
  assert.equal(checkAccessStateWriters([file("services/api/src/modules/crm/x.js", "UPDATE organization_modules SET status = 'disabled'")]).length, 1);
  assert.equal(checkAccessStateWriters([file("apps/web/src/app/api/x/route.ts", "INSERT INTO membership_company_access VALUES ($1)")]).length, 1);
  assert.deepEqual(checkAccessStateWriters([file("services/api/src/core/platform/module-administration.js", "INSERT INTO organization_modules")]), []);

  // New invitation code cannot write only the deprecated legacy shape.
  assert.equal(checkInvitationWrites([file("services/api/src/core/x.js", "INSERT INTO organization_invitations (id, role_id, company_ids)")]).length, 1);
  assert.deepEqual(checkInvitationWrites([file("services/api/src/core/x.js", "INSERT INTO organization_invitations ...; INSERT INTO organization_invitation_roles ...")]), []);

  // Retired split mutations stay retired.
  assert.equal(checkRetiredDefinitions([file("services/api/src/core/x.js", "export async function setUserCompanyAccess() {}")]).length, 1);

  // Administration routes compose through workspaceRoute.
  assert.equal(checkAdminRoutesUseWorkspaceRoute([file("apps/web/src/app/api/settings/users/route.ts", "export async function GET() { const s = await requireApiWorkspace(); }")]).length, 2);
  assert.deepEqual(checkAdminRoutesUseWorkspaceRoute([file("apps/web/src/app/api/settings/users/route.ts", "return workspaceRoute(request, {}, h)")]), []);
  assert.deepEqual(checkAdminRoutesUseWorkspaceRoute([file("apps/web/src/app/api/settings/sessions/route.ts", "requireApiUser()")]), [], "documented self-service exception");

  // Company Administrator cannot regain business permissions via template construction.
  const good = 'export const COMPANY_ADMINISTRATOR_PERMISSIONS = Object.freeze(["users.manage"]);\n  {\n    slug: "company_administrator",\n    permissions: COMPANY_ADMINISTRATOR_PERMISSIONS,\n  },';
  assert.deepEqual(checkCompanyAdministratorTemplate(good), []);
  const subtractive = good.replace("permissions: COMPANY_ADMINISTRATOR_PERMISSIONS", "permissions: ALL_PERMISSIONS.filter((key) => key !== \"billing.manage\")");
  assert.equal(checkCompanyAdministratorTemplate(subtractive).length, 1);
  const derived = good.replace('Object.freeze(["users.manage"])', "Object.freeze([...ALL_PERMISSIONS])");
  assert.equal(checkCompanyAdministratorTemplate(derived).length, 1);
});
