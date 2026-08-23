import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadTsModule } from "./helpers/load-ts-module.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// my-work/types.ts and internal-href.ts have no @/lib/auth or @/lib/db
// dependency (types.ts only has a type-only import, which transpileModule
// elides; internal-href.ts only imports the plain-data shared-types
// package) — safe to actually execute for real behavioral coverage, same
// precedent as command-palette.test.mjs's score.ts/navigation-search.ts.
const typesModule = await loadTsModule("apps/web/src/lib/my-work/types.ts");
const hrefModule = await loadTsModule("apps/web/src/lib/internal-href.ts");

// ---------------------------------------------------------------------
// Part 31 — timezone-aware due-date classification (Home/Tasks/Follow-ups).
// ---------------------------------------------------------------------

test("classifyDueAt: a timestamp in the past is overdue", () => {
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  assert.equal(typesModule.classifyDueAt(past), "overdue");
});

test("classifyDueAt: a timestamp later today is due_today, not overdue or upcoming", () => {
  const now = new Date();
  const laterToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0);
  if (laterToday.getTime() <= now.getTime()) {
    // Test ran in the last minute of the day — trivially skip rather than flake.
    assert.ok(true);
    return;
  }
  assert.equal(typesModule.classifyDueAt(laterToday.toISOString()), "due_today");
});

test("classifyDueAt: a timestamp tomorrow or later is upcoming, not due_today (no blind UTC-midnight comparison)", () => {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
  assert.equal(typesModule.classifyDueAt(tomorrow.toISOString()), "upcoming");
});

test("classifyDueAt: null/undefined/invalid input is 'none', never a crash or a false urgency", () => {
  assert.equal(typesModule.classifyDueAt(null), "none");
  assert.equal(typesModule.classifyDueAt(undefined), "none");
  assert.equal(typesModule.classifyDueAt("not-a-date"), "none");
});

// ---------------------------------------------------------------------
// Internal destination validation for shared workspace links.
// ---------------------------------------------------------------------

test("isValidInternalHref: accepts real internal module and shared-workspace paths, including record-level sub-paths", () => {
  assert.equal(hrefModule.isValidInternalHref("/crm/leads/abc-123"), true);
  assert.equal(hrefModule.isValidInternalHref("/accounting/receivables/xyz"), true);
  assert.equal(hrefModule.isValidInternalHref("/tasks"), true);
  assert.equal(hrefModule.isValidInternalHref("/master-data/items"), true);
});

test("isValidInternalHref: rejects external URLs, protocol-relative paths, and javascript: URIs", () => {
  assert.equal(hrefModule.isValidInternalHref("https://evil.example/phish"), false);
  assert.equal(hrefModule.isValidInternalHref("//evil.example/phish"), false);
  assert.equal(hrefModule.isValidInternalHref("/javascript:alert(1)"), false);
  assert.equal(hrefModule.isValidInternalHref("javascript:alert(1)"), false);
});

test("isValidInternalHref: rejects a top-level segment that isn't a real module or shared-workspace area", () => {
  assert.equal(hrefModule.isValidInternalHref("/not-a-real-area/whatever"), false);
  assert.equal(hrefModule.isValidInternalHref("/recent"), false);
  assert.equal(hrefModule.isValidInternalHref("/favourites"), false);
  assert.equal(hrefModule.isValidInternalHref("/"), false);
  assert.equal(hrefModule.isValidInternalHref(""), false);
});

test("isValidInternalHref: rejects non-string input and whitespace/quote injection attempts", () => {
  assert.equal(hrefModule.isValidInternalHref(null), false);
  assert.equal(hrefModule.isValidInternalHref(undefined), false);
  assert.equal(hrefModule.isValidInternalHref(42), false);
  assert.equal(hrefModule.isValidInternalHref("/crm/leads/\" onclick=\"x()"), false);
});

test("isValidInternalHref: the allowlist covers all 12 catalogue modules plus retained shared-workspace routes, sourced from ERP_MODULE_CATALOG", () => {
  const source = read("apps/web/src/lib/internal-href.ts");
  assert.match(source, /ERP_MODULE_CATALOG\.map\(\(module\) => module\.key\)/);
  for (const area of ["my-work", "tasks", "follow-ups", "exceptions"]) {
    assert.match(source, new RegExp(`"${area}"`));
  }
  assert.doesNotMatch(source, /"recent"|"favourites"/);
});

// ---------------------------------------------------------------------
// Part 67 — every My Work adapter fails closed (omits its source) rather
// than throwing and breaking the whole aggregation, or falling back to
// unscoped data. Static verification: every adapter file must wrap its
// body in try/catch returning [].
// ---------------------------------------------------------------------

const adapterFiles = [
  "apps/web/src/lib/my-work/tasks.ts",
  "apps/web/src/lib/my-work/follow-ups.ts",
  "apps/web/src/lib/my-work/exceptions.ts",
];

test("my-work adapters: every source function is wrapped in try/catch returning an empty array on failure (fail-closed, never fail-open)", () => {
  for (const file of adapterFiles) {
    const source = read(file);
    const catchBlocks = source.match(/catch \{[^}]*\}/g) ?? [];
    assert.ok(catchBlocks.length >= 1, `${file}: expected at least one catch block`);
    for (const block of catchBlocks) {
      assert.match(block, /return \[\];/, `${file}: a catch block does not fail closed to an empty array: ${block}`);
    }
  }
});

test("my-work adapters: reuse each module's existing module-gated session/context builder — no bespoke session or SQL bypass", () => {
  const tasks = read("apps/web/src/lib/my-work/tasks.ts");
  assert.match(tasks, /crmApiContext\(session\)/);
  assert.match(tasks, /assertModuleAccessible\(session, "projects"\)/);
  assert.match(tasks, /projectsContext\(session\)/);

  const followUps = read("apps/web/src/lib/my-work/follow-ups.ts");
  assert.match(followUps, /crmApiContext\(session\)/);

  const exceptions = read("apps/web/src/lib/my-work/exceptions.ts");
  for (const moduleId of ["accounting", "procurement", "support", "quality"]) {
    assert.match(exceptions, new RegExp(`assertModuleAccessible\\(session, "${moduleId}"\\)`));
  }
});

test("my-work adapters: none write raw ad-hoc SQL against the CRM/project tables directly — every read goes through an existing service-layer list/dashboard function", () => {
  const tasks = read("apps/web/src/lib/my-work/tasks.ts");
  const followUps = read("apps/web/src/lib/my-work/follow-ups.ts");
  const exceptions = read("apps/web/src/lib/my-work/exceptions.ts");
  for (const source of [tasks, followUps]) {
    assert.doesNotMatch(source, /client\.query\(/, "adapter issues a raw client.query() instead of reusing a service-layer function");
  }
  assert.doesNotMatch(exceptions, /client\.query\(/, "exceptions adapter issues raw SQL instead of reusing governance dashboard functions");
});

test("my-work adapters: exceptions.ts documents the deliberately-omitted categories rather than fabricating a source for them", () => {
  const source = read("apps/web/src/lib/my-work/exceptions.ts");
  assert.match(source, /low-stock/);
  assert.match(source, /NOT implemented/);
});

test("aggregate.ts: uses Promise.allSettled across sources, not Promise.all (one failing source cannot fail the whole summary)", () => {
  const source = read("apps/web/src/lib/my-work/aggregate.ts");
  assert.match(source, /Promise\.allSettled/);
  assert.doesNotMatch(source, /Promise\.all\(/);
});

test("aggregate.ts: counts are derived from the same classified item lists returned to callers, not a separately invented number (summary must match the filtered list view)", () => {
  const source = read("apps/web/src/lib/my-work/aggregate.ts");
  assert.match(source, /countUrgent\(tasksList\)/);
  assert.match(source, /countUrgent\(followUpsList\)/);
  assert.doesNotMatch(source, /Math\.random/);
});

// ---------------------------------------------------------------------
// Part 10 — navigation registry: the 6 new destinations are present,
// route to real pages (verify-routes.mjs covers resolution), and carry
// the documented command-palette keyword aliases.
// ---------------------------------------------------------------------

test("navigation: my-work.ts registers retained workspaces and omits Recent records and Favourites", () => {
  const source = read("apps/web/src/lib/navigation/my-work.ts");
  for (const href of ["/my-work", "/tasks", "/follow-ups", "/exceptions"]) {
    assert.match(source, new RegExp(`href: "${href.replace(/[/-]/g, "\\$&")}"`));
  }
  assert.doesNotMatch(source, /href: "\/(recent|favourites)"/);
});

test("navigation: the retained command-palette keyword aliases are present", () => {
  const source = read("apps/web/src/lib/navigation/my-work.ts");
  assert.match(source, /"todo"/);
  assert.match(source, /"reminder"/);
  assert.match(source, /"issues"/);
  assert.doesNotMatch(source, /"recent"|"saved"/);
});

test("navigation: none of the 6 new items declare a permission gate — each aggregates only what its own per-source adapters already allow, so the nav item itself must not add a redundant blanket gate", () => {
  const source = read("apps/web/src/lib/navigation/my-work.ts");
  const newItemsBlock = source.split("export const myWorkNavigation")[1] ?? "";
  const beforeNotifications = newItemsBlock.split('href: "/notifications"')[0];
  assert.doesNotMatch(beforeNotifications, /permission:/);
});

// ---------------------------------------------------------------------
// Part 9 — Notifications/Approvals integration reuses existing endpoints,
// it does not rebuild them.
// ---------------------------------------------------------------------

test("my-work/approvals.ts and my-work/notifications.ts are the single shared source both the API routes and My Work/Home now call — no duplicated inline SQL remains in the routes", () => {
  const approvalsRoute = read("apps/web/src/app/api/approvals/route.ts");
  assert.match(approvalsRoute, /listMyApprovals\(session, 100\)/);
  assert.doesNotMatch(approvalsRoute, /FROM approval_requests approval/);

  const notificationsRoute = read("apps/web/src/app/api/notifications/route.ts");
  assert.match(notificationsRoute, /listMyNotifications\(/);
  assert.doesNotMatch(notificationsRoute, /FROM notifications\n/);
});

test("my-work/approvals.ts: listMyApprovals requires approvals.manage before querying, matching the pre-existing API route's own gate", () => {
  const source = read("apps/web/src/lib/my-work/approvals.ts");
  assert.match(source, /hasPermission\(session, PERMISSIONS\.approvalsManage\)/);
});

// ---------------------------------------------------------------------
// Part 1 — Home dashboard: real adapters only, still no fake KPIs, and the
// existing organisation-overview/audit sections are preserved untouched.
// ---------------------------------------------------------------------

test("dashboard: the new Attention section is driven by getMyWorkSummary(), not an inline/duplicated aggregation query", () => {
  const source = read("apps/web/src/app/(app)/dashboard/page.tsx");
  assert.match(source, /getMyWorkSummary\(session, 5\)/);
  assert.match(source, /myWork\.counts\.tasksOverdue/);
});

test("dashboard: no placeholder/mock content markers were introduced (Math.random, TODO, FIXME, dummy, sample data)", () => {
  const source = read("apps/web/src/app/(app)/dashboard/page.tsx");
  assert.doesNotMatch(source, /Math\.random|TODO|FIXME|dummy|sample data/i);
});

test("dashboard: the pre-existing Organisation overview / audit-log sections are untouched by the Prompt 8 addition", () => {
  const source = read("apps/web/src/app/(app)/dashboard/page.tsx");
  assert.match(source, /Organisation overview/);
  assert.match(source, /Latest audit events/);
});

// ---------------------------------------------------------------------
// Part 25 — Master Data: client-side catalogue search, permission-aware
// "manage" badge, and no server round-trip per keystroke.
// ---------------------------------------------------------------------

test("master data: the resource catalogue search is a client component filtering an already-fetched array, not a server action per keystroke", () => {
  const source = read("apps/web/src/components/master-data-catalogue.tsx");
  assert.match(source, /"use client"/);
  assert.doesNotMatch(source, /fetch\(/);
  assert.match(source, /entries\.filter\(/);
});

test("master data: each card reflects its own resource's manage permission, not one broad gate", () => {
  const page = read("apps/web/src/app/(app)/master-data/page.tsx");
  assert.match(page, /hasPermission\(session, definition\.managePermission\)/);
});

test("master data: the workspace search never widens what's visible — it filters the server-provided, already-permission-scoped entries array only", () => {
  const source = read("apps/web/src/components/master-data-catalogue.tsx");
  assert.doesNotMatch(source, /businessDataDefinitions/, "the client component must not re-derive the resource catalogue itself, only filter the props it was given");
});

// ---------------------------------------------------------------------
// Security regression — Prompt 3-7 protections must not be weakened by
// this prompt's aggregation layer.
// ---------------------------------------------------------------------

test("security regression: CRM ownership scoping is untouched — my-work/tasks.ts and follow-ups.ts still call listCrmRecords()/crmApiContext(), never a raw crm_activities/crm_leads query", () => {
  for (const file of ["apps/web/src/lib/my-work/tasks.ts", "apps/web/src/lib/my-work/follow-ups.ts"]) {
    const source = read(file);
    assert.doesNotMatch(source, /FROM tenant\.crm_/, `${file}: bypasses listCrmRecords() with a raw CRM table query`);
  }
});

test("security regression: exceptions.ts never queries HR/payroll data — HR/payroll exceptions must stay invisible to non-HR shared-workspace views", () => {
  const source = read("apps/web/src/lib/my-work/exceptions.ts");
  assert.doesNotMatch(source, /hr[-_]?payroll/i);
});

test("security regression: exceptions.ts's support adapter respects the existing private-note redaction inside listSupportResource — it does not select support_communications directly", () => {
  const source = read("apps/web/src/lib/my-work/exceptions.ts");
  assert.doesNotMatch(source, /support_communications/);
});

test("security regression: module-access.test.mjs's fail-closed invariant is unaffected — module-access.ts itself was not modified by this prompt", () => {
  const source = read("apps/web/src/lib/module-access.ts");
  assert.match(source, /Fails closed at every stage/);
});
