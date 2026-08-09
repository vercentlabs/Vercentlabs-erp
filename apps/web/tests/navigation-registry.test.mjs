import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const sharedTypes = await import(
  pathToFileURL(path.join(root, "packages/shared-types/src/index.js")).href
);

// match-path.ts and route-map.ts have zero imports beyond their own types
// (no auth/db/next dependency), so — unlike the registry data files, which
// transitively import apps/web/src/lib/auth.ts's `next/headers` usage —
// they're safe to actually transpile and execute, giving real behavioral
// coverage rather than only source-pattern checks.
async function loadPureModule(relativePath) {
  const sourcePath = path.join(root, relativePath);
  const source = fs.readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vercent-nav-"));
  const file = path.join(dir, path.basename(relativePath).replace(/\.ts$/, ".mjs"));
  fs.writeFileSync(file, transpiled);
  return import(`${pathToFileURL(file).href}?v=${Date.now()}`);
}

const matchPath = await loadPureModule("apps/web/src/lib/navigation/match-path.ts");
const routeMap = await loadPureModule("apps/web/src/lib/navigation/route-map.ts");

// ---------------------------------------------------------------------
// Part 29 — registry invariants (static source checks for the data files
// themselves, since they transitively import @/lib/authorization ->
// @/lib/auth -> next/headers, which is unsafe to execute outside a real
// Next.js request context — same precedent as module-access.test.mjs).
// ---------------------------------------------------------------------

test("registry: modules.ts declares exactly the 12 canonical moduleIds, matching ERP_MODULE_CATALOG 1:1", () => {
  const source = read("apps/web/src/lib/navigation/modules.ts");
  const declared = [...source.matchAll(/moduleId:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.equal(declared.length, 12, "expected exactly 12 moduleId declarations");
  assert.equal(new Set(declared).size, 12, "duplicate moduleId declared in modules.ts");
  const catalogKeys = sharedTypes.ERP_MODULE_CATALOG.map((m) => m.key).sort();
  assert.deepEqual([...declared].sort(), catalogKeys);
});

test("registry: every module group's items array starts with an exact-match Overview item", () => {
  const source = read("apps/web/src/lib/navigation/modules.ts");
  const groupBodies = source.split(/\{\s*\n\s*label: "/).slice(1);
  assert.equal(groupBodies.length, 12);
  for (const body of groupBodies) {
    const firstItemMatch = body.match(/items:\s*\[\s*\{([\s\S]*?)\},/);
    assert.ok(firstItemMatch, "could not locate first item in a module group");
    assert.match(firstItemMatch[1], /label:\s*"Overview"/);
    assert.match(firstItemMatch[1], /exact:\s*true/);
  }
});

test("registry: no navigation data file promotes a CRUD verb into a top-level label", () => {
  const files = [
    "apps/web/src/lib/navigation/modules.ts",
    "apps/web/src/lib/navigation/workspace.ts",
    "apps/web/src/lib/navigation/my-work.ts",
    "apps/web/src/lib/navigation/governance.ts",
    "apps/web/src/lib/navigation/administration.ts",
  ];
  const verbPattern = /label:\s*"(Create|Edit|Delete|Convert|Merge|Duplicate|Remove) /i;
  for (const file of files) {
    assert.doesNotMatch(read(file), verbPattern, `${file}: a CRUD-verb label was found in navigation data`);
  }
});

test("registry: platform capability areas (Billing, Audit logs, Security, Settings) never collide with a business module id", () => {
  const businessKeys = new Set(sharedTypes.ERP_MODULE_CATALOG.map((m) => m.key));
  for (const id of ["billing", "audit-logs", "security", "settings", "master-data", "notifications", "approvals"]) {
    assert.equal(businessKeys.has(id), false, `"${id}" collides with a business module key`);
  }
});

test("registry: resolve-navigation.ts fails closed on a module-access lookup failure (hides all modules, never shows all)", () => {
  const source = read("apps/web/src/lib/navigation/resolve-navigation.ts");
  assert.match(
    source,
    /catch \{[\s\S]*?accessibleModuleIds = new Set\(\);[\s\S]*?\}/,
    "resolveNavigation's catch block must default accessibleModuleIds to an empty set, not all modules",
  );
});

test("registry: resolve-navigation.ts filters module groups by accessibleModuleIds and prunes empty groups", () => {
  const source = read("apps/web/src/lib/navigation/resolve-navigation.ts");
  assert.match(source, /accessibleModuleIds\.has\(group\.moduleId\)/);
  assert.match(source, /\.filter\(\(group\) => group\.items\.length > 0\)/);
});

test("registry: resolve-navigation.ts uses Prompt 4/5's canonical getAccessibleModules() rather than re-deriving module access", () => {
  const source = read("apps/web/src/lib/navigation/resolve-navigation.ts");
  assert.match(source, /import \{ getAccessibleModules \} from "@\/lib\/module-access";/);
  assert.doesNotMatch(source, /organization_modules|getBillingSummary\(/, "must not re-implement module-access.ts's own DB/billing logic");
});

// ---------------------------------------------------------------------
// Part 33 — route validation exists and covers the registry (delegates
// the actual filesystem check to verify-routes.mjs, run separately by
// verify:web; this just confirms the check is wired up, not duplicating
// its logic).
// ---------------------------------------------------------------------

test("route validation: verify-routes.mjs checks navigation registry hrefs, not just page.tsx/route.ts existence", () => {
  const source = read("apps/web/scripts/verify-routes.mjs");
  assert.match(source, /navigation registry href/i);
  assert.match(source, /routeExists/);
});

// ---------------------------------------------------------------------
// match-path.ts / route-map.ts — real behavioral tests (safe to execute).
// ---------------------------------------------------------------------

test("matchesPath: exact items only match their own path", () => {
  assert.equal(matchPath.matchesPath("/crm", { href: "/crm", exact: true }), true);
  assert.equal(matchPath.matchesPath("/crm/leads", { href: "/crm", exact: true }), false);
});

test("matchesPath: non-exact items match themselves and any sub-path, not a similarly-prefixed sibling", () => {
  assert.equal(matchPath.matchesPath("/crm/leads", { href: "/crm/leads" }), true);
  assert.equal(matchPath.matchesPath("/crm/leads/abc-123", { href: "/crm/leads" }), true);
  assert.equal(matchPath.matchesPath("/crm/leads-archive", { href: "/crm/leads" }), false, "must not treat '/crm/leads-archive' as active for '/crm/leads' (no segment boundary)");
});

test("matchesPath: /dashboard never prefix-matches even when exact is not explicitly set", () => {
  assert.equal(matchPath.matchesPath("/dashboard/anything", { href: "/dashboard" }), false);
  assert.equal(matchPath.matchesPath("/dashboard", { href: "/dashboard" }), true);
});

test("matchesPath: activePrefixes provide an alias match for renamed/legacy routes", () => {
  assert.equal(
    matchPath.matchesPath("/crm/lead-acquisition", { href: "/crm/leads", activePrefixes: ["/crm/lead-acquisition"] }),
    true,
  );
});

test("moduleIdForPath: resolves a pathname to its owning module, or null outside any module root", () => {
  assert.equal(routeMap.moduleIdForPath("/crm"), "crm");
  assert.equal(routeMap.moduleIdForPath("/crm/leads/abc"), "crm");
  assert.equal(routeMap.moduleIdForPath("/point-of-sale/terminals"), "point-of-sale");
  assert.equal(routeMap.moduleIdForPath("/dashboard"), null);
  assert.equal(routeMap.moduleIdForPath("/settings/users"), null);
  assert.equal(routeMap.moduleIdForPath("/crmageddon"), null, "must not prefix-collide with a similarly-named path");
});

test("MODULE_ROUTE_ROOTS: exactly the 12 canonical modules, each a distinct root", () => {
  const roots = Object.values(routeMap.MODULE_ROUTE_ROOTS);
  assert.equal(roots.length, 12);
  assert.equal(new Set(roots).size, 12);
});

// ---------------------------------------------------------------------
// Client-bundle safety — a real `next build` failure was found and fixed
// during this prompt: breadcrumbs.tsx ("use client") imports
// breadcrumb-labels.ts, which imports the five navigation data files,
// which imported PERMISSIONS from @/lib/authorization — a file that also
// exports session/DB-touching functions and therefore transitively
// requires @/lib/auth -> @/lib/db -> pg (node:async_hooks), none of which
// can be bundled for the browser. Fixed by splitting PERMISSIONS into
// permissions-catalog.ts (zero @/lib/auth dependency). This test prevents
// the same mistake from being reintroduced without a `next build` run.
// ---------------------------------------------------------------------

test("client-bundle safety: navigation data files reachable from breadcrumbs.tsx never import @/lib/auth or @/lib/authorization directly", () => {
  const files = [
    "apps/web/src/lib/navigation/workspace.ts",
    "apps/web/src/lib/navigation/my-work.ts",
    "apps/web/src/lib/navigation/governance.ts",
    "apps/web/src/lib/navigation/administration.ts",
    "apps/web/src/lib/navigation/modules.ts",
    "apps/web/src/lib/navigation/breadcrumb-labels.ts",
    "apps/web/src/lib/navigation/match-path.ts",
    "apps/web/src/lib/navigation/route-map.ts",
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /from "@\/lib\/auth(orization)?"/,
      `${file} is reachable from the client component breadcrumbs.tsx and must not import @/lib/auth or @/lib/authorization (pulls in pg/node:async_hooks into the browser bundle) — use @/lib/permissions-catalog for PERMISSIONS instead`,
    );
  }
});

test("permissions-catalog.ts (the PERMISSIONS source navigation data files use) has no @/lib/auth dependency", () => {
  const source = read("apps/web/src/lib/permissions-catalog.ts");
  assert.doesNotMatch(source, /from "@\/lib\//);
  assert.match(source, /from "@vercentlabs\/permissions"/);
});

test("authorization.ts re-exports PERMISSIONS from permissions-catalog.ts rather than redefining it (single source of truth)", () => {
  const source = read("apps/web/src/lib/authorization.ts");
  assert.match(source, /import \{ PERMISSIONS \} from "@\/lib\/permissions-catalog";/);
  assert.match(source, /export \{ PERMISSIONS \};/);
});
