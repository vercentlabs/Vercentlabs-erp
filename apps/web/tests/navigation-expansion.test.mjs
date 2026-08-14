import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// SidebarModules/NavigationSection are Client Components using React hooks
// (useState/usePathname) — the repository has no browser/DOM component-test
// framework (confirmed in docs/implementation/ERP_WEB_AUDIT_001.md, Section
// 13: "no modal/dialog/drawer pattern... every edit flow is a full page").
// Interaction is verified by source-pattern checks on the coordination
// mechanism itself (a single `expanded` state value can only equal one
// group's id at a time, by construction — not by simulating clicks), plus
// the already-executed moduleIdForPath tests in navigation-registry.test.mjs
// covering the pure route-driven-initial-state logic these components call.

// ---------------------------------------------------------------------
// Part 11/31 — one module expanded at a time; route-driven initial state.
// ---------------------------------------------------------------------

test("expansion: SidebarModules owns exactly one `expanded` state value, not one flag per module", () => {
  const source = read("apps/web/src/components/sidebar-modules.tsx");
  // Two useState calls total: `expanded` (the one shared value every
  // module's `open` prop compares against) and `lastRouteModuleId` (React's
  // documented "adjusting state when a prop changes during render" pattern,
  // used instead of useEffect to avoid a cascading-render lint violation) —
  // neither is a per-module flag.
  const stateDeclarations = source.match(/useState[<(]/g) ?? [];
  assert.equal(stateDeclarations.length, 2, "expected exactly two useState calls (expanded + lastRouteModuleId), not one flag per module");
  assert.match(source, /const \[expanded, setExpanded\] = useState<string \| null>\(routeModuleId\);/);
  assert.doesNotMatch(source, /useEffect/, "must not use an effect to sync state from a value already available during render (react-hooks/set-state-in-effect)");
});

test("expansion: opening a module sets `expanded` to only that module's id, which by construction closes every other module's `open` prop", () => {
  const source = read("apps/web/src/components/sidebar-modules.tsx");
  assert.match(source, /onOpenChange=\{\(open\) => setExpanded\(open \? group\.moduleId : null\)\}/);
  assert.match(source, /open=\{expanded === group\.moduleId\}/);
});

test("expansion: initial/ongoing expansion is route-derived via moduleIdForPath, not label string matching", () => {
  const source = read("apps/web/src/components/sidebar-modules.tsx");
  assert.match(source, /import \{ moduleIdForPath \} from "@\/lib\/navigation\/route-map";/);
  assert.doesNotMatch(source, /\.label ===|label\.toLowerCase\(\)/, "must not derive expansion from a label string");
  assert.match(source, /if \(routeModuleId\) setExpanded\(routeModuleId\);/);
});

test("expansion: the new HCI shell moves global/module presentation out of the legacy expanding module accordion without changing its authorization source", () => {
  const appShell = read("apps/web/src/components/app-shell.tsx");
  assert.match(appShell, /<PrimaryNavigationRail/);
  assert.match(appShell, /<ContextSecondarySidebar/);
  assert.match(appShell, /<MobileWorkspaceNavigation/);
  assert.doesNotMatch(appShell, /<SidebarShell|<ModuleContextBar/, "the old single-sidebar/module-tab presentation must not be mounted by AppShell");
});

test("expansion: NavigationSection supports both controlled (module sidebar) and uncontrolled (auto route-active) modes without duplicating active-match logic", () => {
  const source = read("apps/web/src/components/navigation-section.tsx");
  assert.match(source, /const open = controlledOpen \?\? active;/);
  assert.match(source, /import \{ matchesPath, type MatchablePath \} from "@\/lib\/navigation\/match-path";/);
  assert.doesNotMatch(source, /function matchesPath/, "navigation-section.tsx must not keep its own duplicate matchesPath implementation");
});

test("expansion: navigation-link.tsx and module-context-bar.tsx also consume the single shared matcher (no third/fourth duplicate implementation remains)", () => {
  const navLink = read("apps/web/src/components/navigation-link.tsx");
  assert.match(navLink, /import \{ matchesPath \} from "@\/lib\/navigation\/match-path";/);
  assert.doesNotMatch(navLink, /pathname\.startsWith/, "navigation-link.tsx must delegate matching to the shared helper, not inline startsWith checks");

  const contextBar = read("apps/web/src/components/module-context-bar.tsx");
  assert.match(contextBar, /import \{ matchesPath \} from "@\/lib\/navigation\/match-path";/);
  assert.doesNotMatch(contextBar, /function matches\(pathname/, "module-context-bar.tsx must not keep its own duplicate matches() implementation");
});

test("expansion: aria-expanded is present on the collapsible summary control (accessibility by construction)", () => {
  const source = read("apps/web/src/components/navigation-section.tsx");
  assert.match(source, /<summary aria-expanded=\{open\}>/);
});
