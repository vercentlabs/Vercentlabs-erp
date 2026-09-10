// CRM vNext Prompt 2 — real behavioral coverage for the redesigned CRM
// navigation information architecture (docs/03-modules/crm/
// CRM_VNEXT_IMPLEMENTATION_REGISTER.md, Prompt 2 target tree). Uses the
// existing tests/helpers/load-ts-module.mjs loader (a real TypeScript
// compile + @/ alias rewrite, not a mock) to execute the actual
// apps/web/src/core/navigation/modules.ts registry and
// module-navigation-ia.ts grouping function — this proves the live
// grouping behavior, not just that certain strings appear in the source.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const modulesMod = await loadTsModule("apps/web/src/core/navigation/modules.ts");
const iaMod = await loadTsModule("apps/web/src/core/navigation/module-navigation-ia.ts");

function crmModule() {
  const found = modulesMod.moduleNavigation.find((entry) => entry.moduleId === "crm");
  assert.ok(found, "CRM module navigation group must exist in the registry");
  return found;
}

test("CRM navigation: the registry declares the CRM v2 destinations exactly once", () => {
  const crm = crmModule();
  const hrefs = crm.items.map((item) => item.href);
  assert.deepEqual(
    hrefs,
    [
      "/crm",
      "/crm/leads",
      "/crm/accounts",
      "/crm/contacts",
      "/crm/opportunities",
      "/crm/pipeline",
      "/crm/forecast",
      "/crm/work",
      "/crm/activities",
      "/crm/tasks",
      "/crm/calls",
      "/crm/meetings",
      "/crm/follow-ups",
      "/crm/inbox",
      "/crm/reports",
      "/crm/sales-teams",
      "/crm/territories",
      "/crm/quota-plans",
      "/crm/settings",
    ],
  );
  assert.equal(new Set(hrefs).size, hrefs.length, "no duplicate CRM navigation hrefs");
});

test("CRM navigation: every destination is permission-gated (no ungated CRM destination)", () => {
  const crm = crmModule();
  for (const item of crm.items) {
    assert.ok(item.permission, `${item.href} must declare a permission — CRM has no publicly-visible destination`);
  }
});

test("CRM navigation: grouping produces the CRM v2 information architecture", () => {
  const crm = crmModule();
  const grouped = iaMod.groupModuleNavigation(crm);
  const shape = grouped.map((group) => [group.label, group.items.map((item) => item.label)]);
  assert.deepEqual(shape, [
    ["Home", ["Home"]],
    ["Customers", ["Leads", "Accounts", "Contacts"]],
    ["Pipeline", ["Opportunities", "Pipeline board", "Forecast"]],
    ["Work", ["My work", "Activity timeline", "Tasks", "Calls", "Meetings", "Follow-ups"]],
    ["Engagement", ["Team inbox"]],
    ["Insights", ["Reports"]],
    ["Revenue operations", ["Sales teams", "Territories", "Quotas"]],
    ["Administration", ["CRM setup"]],
  ]);
});

test("CRM navigation: the top-level entry is labeled Home (not the retired 'Overview' label), matching CRM Home's own status as a daily workspace, not a passive dashboard", () => {
  const crm = crmModule();
  const home = crm.items.find((item) => item.href === "/crm");
  assert.equal(home.label, "Home");
  assert.equal(home.exact, true);
});

test("CRM navigation: no navigation label leaks internal F-ID or governance-register terminology", () => {
  const crm = crmModule();
  const grouped = iaMod.groupModuleNavigation(crm);
  for (const group of grouped) {
    assert.doesNotMatch(group.label, /F0\d\d/, `group label "${group.label}" must not contain a feature ID`);
    for (const item of group.items) {
      assert.doesNotMatch(item.label, /F0\d\d/, `item label "${item.label}" must not contain a feature ID`);
    }
  }
});

test("CRM navigation: the sidebar renderers suppress the redundant group heading for CRM's Home group, the same way they already do for every other module's Overview group (regression: renaming the group from 'Overview' to 'Home' initially left a duplicate 'Home' heading stacked above the 'Home' link, caught by rendered-browser verification)", () => {
  const desktop = fs.readFileSync(new URL("../src/core/components/context-secondary-sidebar.tsx", import.meta.url), "utf8");
  const mobile = fs.readFileSync(new URL("../src/core/components/mobile-workspace-navigation.tsx", import.meta.url), "utf8");
  for (const source of [desktop, mobile]) {
    assert.match(source, /group\.label === "Overview" \|\| group\.label === "Home" \? null :/);
  }
});

test("CRM navigation: every declared CRM href resolves to a real, already-shipped route", () => {
  const appRoot = fileURLToPath(new URL("../src/app/(app)", import.meta.url));
  function resolveSegments(dir, segments) {
    if (segments.length === 0) return fs.existsSync(`${dir}/page.tsx`);
    const [segment, ...rest] = segments;
    const literal = `${dir}/${segment}`;
    if (fs.existsSync(literal) && fs.statSync(literal).isDirectory() && resolveSegments(literal, rest)) return true;
    const dynamicSiblings = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith("["));
    return dynamicSiblings.some((sibling) => resolveSegments(`${dir}/${sibling.name}`, rest));
  }
  const crm = crmModule();
  for (const item of crm.items) {
    const segments = item.href.split("/").filter(Boolean);
    assert.ok(resolveSegments(appRoot, segments), `${item.href} must resolve to a real page.tsx under src/app/(app)`);
  }
});
