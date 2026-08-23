import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadTsModule } from "./helpers/load-ts-module.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// score.ts, navigation-search.ts and recent.ts have zero @/lib/auth or
// @/lib/db dependency (score.ts has no imports at all; navigation-search.ts
// only imports scoreLabel + erased types; recent.ts only reads/writes
// localStorage) — safe to actually transpile and execute for real
// behavioral coverage, unlike anything that touches session/DB (Prompt
// 4-6's established precedent). load-ts-module.mjs recursively resolves
// same-package "@/..." imports (e.g. navigation-search.ts -> score.ts).
const scoreModule = await loadTsModule("apps/web/src/core/search/score.ts");
const navSearchModule = await loadTsModule("apps/web/src/core/search/navigation-search.ts");
const recentModule = await loadTsModule("apps/web/src/core/search/recent.ts");

// ---------------------------------------------------------------------
// Part 29 — fuzzy-match scoring priority.
// ---------------------------------------------------------------------

test("scoring: exact label match ranks above starts-with, word-prefix, keyword alias and substring", () => {
  const exact = scoreModule.scoreLabel("leads", "Leads");
  const startsWith = scoreModule.scoreLabel("lead", "Leads");
  const wordPrefix = scoreModule.scoreLabel("gen", "Lead Generation");
  const keywordAlias = scoreModule.scoreLabel("pos", "Point of Sale", ["pos", "retail"]);
  const substring = scoreModule.scoreLabel("oint", "Point of Sale");
  assert.ok(exact > startsWith);
  assert.ok(startsWith > wordPrefix);
  assert.ok(wordPrefix > keywordAlias);
  assert.ok(keywordAlias > substring);
});

test("scoring: keyword alias works even when the label itself has no textual relation to the query", () => {
  const score = scoreModule.scoreLabel("payroll", "HR & Payroll", ["hr", "employee", "salary", "payroll"]);
  assert.ok(score !== null && score > 0);
});

test("scoring: no match returns null, not zero (callers must be able to filter it out)", () => {
  assert.equal(scoreModule.scoreLabel("zzz-nonexistent", "Leads"), null);
  assert.equal(scoreModule.scoreLabel("", "Leads"), null);
});

// ---------------------------------------------------------------------
// Part 4/47 — navigation search over the already-resolved tree.
// ---------------------------------------------------------------------

function fixtureNavigation() {
  return {
    workspace: [{ href: "/dashboard", label: "Home", icon: "dashboard" }],
    modules: [
      {
        moduleId: "crm",
        label: "CRM",
        icon: "crm",
        keywords: ["customers", "pipeline"],
        items: [
          { href: "/crm", label: "Overview", icon: "dashboard", exact: true },
          { href: "/crm/leads", label: "Leads", icon: "crm" },
        ],
      },
    ],
    myWork: [{ href: "/notifications", label: "Notifications", icon: "notifications" }],
    governance: [{ href: "/billing", label: "Billing", icon: "billing" }],
    administration: [{ href: "/security", label: "Security", icon: "security" }],
    workspaceSettings: { id: "workspace-settings", label: "Workspace settings", items: [] },
  };
}

test("navigation search: an accessible module's items are found by label", () => {
  const results = navSearchModule.searchNavigation(fixtureNavigation(), "lead", 8);
  assert.ok(results.some((r) => r.href === "/crm/leads"));
  assert.equal(results[0].type, "navigation");
});

test("navigation search: an inaccessible module never appears because it was never in the input tree — the function has no way to reach it", () => {
  // resolveNavigation() (server-side) already removed any module the user
  // can't access before this ever runs; simulate that by omitting "sales"
  // entirely from the fixture and confirming a sales query finds nothing.
  const results = navSearchModule.searchNavigation(fixtureNavigation(), "quotation", 8);
  assert.equal(results.length, 0);
});

test("navigation search: module-level keyword aliases surface the module overview", () => {
  const results = navSearchModule.searchNavigation(fixtureNavigation(), "pipeline", 8);
  assert.ok(results.some((r) => r.label === "CRM"));
});

test("navigation search: results are capped at the requested limit", () => {
  const results = navSearchModule.searchNavigation(fixtureNavigation(), "e", 1);
  assert.ok(results.length <= 1);
});

test("navigation search: never queries a server — flattenNavigation and searchNavigation are pure, synchronous functions", () => {
  const source = read("apps/web/src/core/search/navigation-search.ts");
  assert.doesNotMatch(source, /fetch\(|await /);
});

// ---------------------------------------------------------------------
// Part 9 — recent destinations (localStorage only, no sensitive payload).
// ---------------------------------------------------------------------

test("recent destinations: degrades to empty/no-op outside a browser (no window) rather than throwing", () => {
  assert.deepEqual(recentModule.getRecentDestinations(), []);
  assert.doesNotThrow(() => recentModule.recordRecentDestination({ id: "nav:/crm", type: "navigation", label: "CRM", href: "/crm" }));
});

test("recent destinations: storage schema only ever carries label/href/icon/moduleId metadata, never a query string or record payload field", () => {
  const source = read("apps/web/src/core/search/recent.ts");
  // Check the actual stored-field allowlist (the type alias and the
  // object literal that gets persisted), not prose — this file's own
  // comments legitimately discuss "query"/"payload" while explaining why
  // neither is stored.
  assert.match(source, /type RecentEntry = Pick<SearchResult, "id" \| "type" \| "label" \| "description" \| "href" \| "icon" \| "moduleId">;/);
  assert.doesNotMatch(source, /\.query\b|\bpayload:|\bfilters:/);
});

// ---------------------------------------------------------------------
// Part 47/54 — command-palette.tsx source-pattern checks (the component
// itself is a Client Component using useRouter/createPortal — unsafe to
// execute outside a real DOM/Next.js runtime, so verified structurally,
// same precedent as every other interactive component in this codebase).
// ---------------------------------------------------------------------

test("command palette: exactly one Ctrl/Cmd+K listener exists in the app (the old workspace-search.tsx focus-only handler was deleted, not left as a second listener)", () => {
  assert.equal(fs.existsSync(path.join(root, "apps/web/src/components/workspace-search.tsx")), false, "workspace-search.tsx should have been removed, not left as a second Ctrl+K listener");
  const matches = [...fs.readdirSync(path.join(root, "apps/web/src/components"))].filter((file) => {
    if (!file.endsWith(".tsx")) return false;
    const source = read(`apps/web/src/components/${file}`);
    return /key\.toLowerCase\(\) === "k"/.test(source);
  });
  assert.deepEqual(matches, ["command-palette.tsx"]);
});

test("command palette: ignores the shortcut while IME composition is active", () => {
  const source = read("apps/web/src/core/components/command-palette.tsx");
  assert.match(source, /isComposing/);
});

test("command palette: Escape, ArrowUp/ArrowDown, Enter, Home and End are all handled", () => {
  const source = read("apps/web/src/core/components/command-palette.tsx");
  for (const key of ["Escape", "ArrowDown", "ArrowUp", "Home", "End", "Enter"]) {
    assert.match(source, new RegExp(`event\\.key === "${key}"`), `missing handling for ${key}`);
  }
});

test("command palette: stale server-search responses cannot overwrite newer results (request token comparison before every setState)", () => {
  const source = read("apps/web/src/core/components/command-palette.tsx");
  const tokenChecks = source.match(/token !== requestTokenRef\.current/g) ?? [];
  assert.ok(tokenChecks.length >= 3, "expected the token guard before each async setState in the fetch callback");
});

test("command palette: focus is restored to the previously-focused element on close", () => {
  const source = read("apps/web/src/core/components/command-palette.tsx");
  assert.match(source, /lastFocusedRef\.current\?\.focus\(\)/);
});

test("command palette: navigation happens via router.push with a result's own href, never by constructing a path from raw query text", () => {
  const source = read("apps/web/src/core/components/command-palette.tsx");
  assert.match(source, /router\.push\(result\.href\)/);
  assert.doesNotMatch(source, /router\.push\(`.*\$\{query/);
});

test("command palette: dialog is a real role=\"dialog\" with aria-modal, not a bare div", () => {
  const source = read("apps/web/src/core/components/command-palette.tsx");
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
});

test("command palette: company/branch context switch clears cached record results (Part 39/41)", () => {
  const source = read("apps/web/src/core/components/command-palette.tsx");
  assert.match(source, /contextKey = `\$\{activeCompanyId/);
  assert.match(source, /setRecordResults\(\[\]\);/);
});
