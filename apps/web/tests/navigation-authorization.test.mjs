import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Static source-pattern verification — resolve-navigation.ts and
// module-page-guard.tsx transitively import @/core/auth (next/headers) and
// @/core/module-access (pg/billing), which are unsafe to execute outside a
// real Next.js request/DB context (same documented limitation as Prompt
// 4/5's module-access.test.mjs and tenant-isolation-rls.test.mjs). Actual
// runtime behavior is exercised by `pnpm typecheck`/`pnpm build` (which
// compile and statically analyze every call site) and by
// apps/web/scripts/verify-routes.mjs (real filesystem href resolution).

// ---------------------------------------------------------------------
// Part 30 — authorization filtering.
// ---------------------------------------------------------------------

test("authorization: an inaccessible module's entire group is removed, not just permission-filtered", () => {
  const source = read("apps/web/src/core/navigation/resolve-navigation.ts");
  // The .filter on accessibleModuleIds runs before the permission map, so a
  // module absent from the set never reaches visiblePermissionItems at all.
  assert.match(
    source,
    /moduleNavigation\s*\.filter\(\(group\) => accessibleModuleIds\.has\(group\.moduleId\)\)\s*\.map\(\(group\) => \(\{ \.\.\.group, items: visiblePermissionItems\(/,
  );
});

test("authorization: items within an accessible module are still individually permission-filtered (module access is not a permission bypass)", () => {
  const source = read("apps/web/src/core/navigation/resolve-navigation.ts");
  assert.match(source, /visiblePermissionItems\(session, group\.items\)/);
});

test("authorization: visiblePermissionItems denies by default (item.permission set and not held -> excluded)", () => {
  const source = read("apps/web/src/core/navigation/resolve-navigation.ts");
  assert.match(
    source,
    /items\.filter\(\(item\) => !item\.permission \|\| hasPermission\(session, item\.permission\)\)/,
  );
});

test("authorization: administration items and workspace settings are permission-filtered like every other section (no unconditional Administration visibility)", () => {
  const source = read("apps/web/src/core/navigation/resolve-navigation.ts");
  assert.match(source, /administration:\s*visiblePermissionItems\(session, administrationNavigation\)/);
  assert.match(source, /settingsItems = visiblePermissionItems\(session, workspaceSettingsSection\.items\)/);
});

test("authorization: CRM ownership/record-scope security (Prompt 3) is untouched by the navigation layer", () => {
  // The navigation registry only ever imports PERMISSIONS/hasPermission and
  // Prompt 4/5's module-access resolver — never services/api/src/modules/crm/index.js's
  // recordScope()/ownerField, which remains the sole authority for
  // per-record CRM access.
  const files = [
    "apps/web/src/core/navigation/modules.ts",
    "apps/web/src/core/navigation/resolve-navigation.ts",
  ];
  for (const file of files) {
    assert.doesNotMatch(read(file), /recordScope|ownerField|crm\.records\.view_all/);
  }
});

// ---------------------------------------------------------------------
// Part 32 — direct server page access (module-page-guard.tsx + the 12
// module route-group layouts).
// ---------------------------------------------------------------------

const moduleLayouts = [
  ["apps/web/src/app/(app)/crm/layout.tsx", "crm"],
  ["apps/web/src/app/(app)/sales/layout.tsx", "sales"],
  ["apps/web/src/app/(app)/accounting/layout.tsx", "accounting"],
  ["apps/web/src/app/(app)/procurement/layout.tsx", "procurement"],
  ["apps/web/src/app/(app)/stock/layout.tsx", "stock"],
  ["apps/web/src/app/(app)/manufacturing/layout.tsx", "manufacturing"],
  ["apps/web/src/app/(app)/projects/layout.tsx", "projects"],
  ["apps/web/src/app/(app)/assets/layout.tsx", "assets"],
  ["apps/web/src/app/(app)/point-of-sale/layout.tsx", "point-of-sale"],
  ["apps/web/src/app/(app)/quality/layout.tsx", "quality"],
  ["apps/web/src/app/(app)/support/layout.tsx", "support"],
  ["apps/web/src/app/(app)/hr-payroll/layout.tsx", "hr-payroll"],
];

test("page access: all 12 module route roots have a layout.tsx wrapping children in ModulePageGuard with the correct moduleId", () => {
  assert.equal(moduleLayouts.length, 12);
  for (const [file, moduleId] of moduleLayouts) {
    const source = read(file);
    assert.match(source, /import ModulePageGuard from "@\/core\/components\/module-page-guard";/, `${file}: missing ModulePageGuard import`);
    assert.match(
      source,
      new RegExp(`<ModulePageGuard moduleId="${moduleId}">`),
      `${file}: does not gate its children with moduleId="${moduleId}"`,
    );
  }
});

test("page access: CRM layout keeps the module guard around the canonical HCI shell", () => {
  const source = read("apps/web/src/app/(app)/crm/layout.tsx");
  assert.match(source, /<ModulePageGuard moduleId="crm">[\s\S]*crm-hci-shell[\s\S]*\{children\}[\s\S]*<\/ModulePageGuard>/);
  assert.doesNotMatch(source, /CrmSectionTabs/);
});

test("page access: ModulePageGuard fails closed — renders the denial UI whenever access.accessible is false, never falls through to children by default", () => {
  const source = read("apps/web/src/core/components/module-page-guard.tsx");
  assert.match(source, /if \(!access\.accessible\) \{\s*return <ModuleAccessDenied/);
  // The success path must be the ONLY other return, and it must be
  // unconditional on the accessible branch already having been checked.
  const returns = source.match(/return /g) ?? [];
  assert.equal(returns.length, 2, "expected exactly one denial return and one success return");
});

test("page access: ModuleAccessDenied never renders raw internal reason text — every ModuleAccessReason has explicit, non-leaking copy", () => {
  const source = read("apps/web/src/core/components/module-access-denied.tsx");
  for (const reason of ["not_released", "disabled", "not_entitled", "not_permitted"]) {
    assert.match(source, new RegExp(`${reason}:\\s*\\{`), `missing copy for reason "${reason}"`);
  }
});

test("page access: the admin module-management API route is unaffected by page-level guards (it lives under /api, not a module route root)", () => {
  const source = read("apps/web/src/app/api/modules/[key]/route.ts");
  assert.doesNotMatch(source, /ModulePageGuard/);
});

test("page access: an unknown/non-module route never accidentally resolves to a moduleId (module-route mapping is an explicit allowlist, not inferred)", () => {
  const source = read("apps/web/src/core/navigation/route-map.ts");
  assert.match(source, /Object\.freeze\(\{/);
  assert.match(source, /return match \? match\[0\] : null;/);
});
