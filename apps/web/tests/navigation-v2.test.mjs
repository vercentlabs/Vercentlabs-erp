import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("navigation v2: AppShell mounts one primary rail, one contextual secondary navigation and the mobile two-step navigator", () => {
  const source = read("apps/web/src/core/components/app-shell.tsx");
  assert.match(source, /<PrimaryNavigationRail/);
  assert.match(source, /<ContextSecondarySidebar/);
  assert.match(source, /<MobileWorkspaceNavigation/);
  assert.doesNotMatch(source, /<SidebarShell|<ModuleContextBar/);
});

test("navigation v2: primary rail uses the canonical resolved module array rather than a second 12-module hardcoded list", () => {
  const source = read("apps/web/src/core/components/primary-navigation-rail.tsx");
  assert.match(source, /navigation\.modules\.map/);
  assert.match(source, /moduleIdForPath\(pathname\)/);
  assert.doesNotMatch(source, /PERMISSIONS|hasPermission|resolveModuleAccess/);
});

test("navigation v2: secondary navigation only consumes already-resolved navigation and does not reimplement authorization", () => {
  const source = read("apps/web/src/core/components/context-secondary-sidebar.tsx");
  assert.match(source, /ResolvedNavigationWithSettings/);
  assert.match(source, /navigation\.modules\.find/);
  assert.doesNotMatch(source, /PERMISSIONS|hasPermission|resolveModuleAccess|getAccessibleModules/);
});

test("navigation v2: product labels use the concise Data and Work terminology", () => {
  const workspaceNavigation = read("apps/web/src/core/navigation/workspace.ts");
  const workNavigation = read("apps/web/src/core/navigation/my-work.ts");
  const primaryRail = read("apps/web/src/core/components/primary-navigation-rail.tsx");
  const mobileNavigation = read("apps/web/src/core/components/mobile-workspace-navigation.tsx");

  assert.match(workspaceNavigation, /href: "\/master-data",\s*label: "Data"/);
  assert.match(workNavigation, /href: "\/my-work", label: "Work"/);
  assert.match(primaryRail, /label="Work"/);
  assert.match(mobileNavigation, /title: "Work"/);
  assert.doesNotMatch(primaryRail, /label="My work"/);
  assert.doesNotMatch(mobileNavigation, /(?:title|label):?="?My work/);
});

test("navigation v2: local navigation search is in-memory over authorized items, with no fetch or database path", () => {
  const secondary = read("apps/web/src/core/components/context-secondary-sidebar.tsx");
  const ia = read("apps/web/src/core/navigation/module-navigation-ia.ts");
  assert.match(secondary, /filterGroupedNavigation/);
  assert.match(ia, /navigationItemSearchText/);
  assert.doesNotMatch(secondary, /fetch\(|client\.query|useSWR|axios/i);
});

test("navigation v2: rail hover/keyboard-focus expansion overlays a fixed-width grid track without mouse clicks pinning it open", () => {
  const css = read("apps/web/src/app/navigation-v2.css");
  assert.match(css, /--v2-primary-rail-width:\s*68px/);
  assert.match(css, /--v2-primary-rail-expanded-width:\s*244px/);
  assert.match(css, /grid-template-columns:\s*var\(--v2-primary-rail-width\)/);
  assert.match(css, /primary-navigation-rail:hover \.primary-navigation-rail__surface/);
  assert.match(css, /primary-navigation-rail:has\(:focus-visible\) \.primary-navigation-rail__surface/);
  assert.doesNotMatch(css, /primary-navigation-rail:focus-within/);
});

test("navigation v2: mobile uses a two-step context model instead of rendering two fixed sidebars", () => {
  const mobile = read("apps/web/src/core/components/mobile-workspace-navigation.tsx");
  const css = read("apps/web/src/app/navigation-v2.css");
  assert.match(mobile, /type MobileView/);
  assert.match(mobile, /All navigation/);
  assert.match(mobile, /setView\(`module:\$\{module\.moduleId\}`\)/);
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /\.primary-navigation-rail,\s*\.context-secondary-sidebar\s*\{\s*display:\s*none;/);
});

test("navigation v2: focus-visible and reduced-motion behavior are explicit", () => {
  const css = read("apps/web/src/app/navigation-v2.css");
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("navigation v2: rail brand keeps its design with deliberate spacing and typography", () => {
  const css = read("apps/web/src/app/navigation-v2.css");

  assert.match(
    css,
    /\.v2-rail-brand \{[\s\S]*?grid-template-columns: 44px minmax\(0, 1fr\);[\s\S]*?gap: 12px;[\s\S]*?padding: 8px 12px 8px 8px;/,
  );
  assert.match(
    css,
    /\.v2-rail-brand__copy \{[\s\S]*?gap: 3px;[\s\S]*?font-family: inherit;/,
  );
  assert.match(
    css,
    /\.v2-rail-brand__copy strong \{[\s\S]*?font-size: 14px;[\s\S]*?font-weight: 750;[\s\S]*?line-height: 1\.2;/,
  );
  assert.match(
    css,
    /\.v2-rail-brand__copy small \{[\s\S]*?font-size: 11px;[\s\S]*?font-weight: 500;[\s\S]*?line-height: 1\.3;/,
  );
});

test("navigation v2: the new CSS is loaded last after the existing ERP style layers", () => {
  const layout = read("apps/web/src/app/layout.tsx");
  const oldIndex = layout.indexOf('import "./crm-lead-suite-enterprise.css";');
  const newIndex = layout.indexOf('import "./navigation-v2.css";');
  assert.ok(oldIndex >= 0 && newIndex > oldIndex);
});
