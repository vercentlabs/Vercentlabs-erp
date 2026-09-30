// The CRM information architecture, proven against the real registry and
// the real built-in roles. Product rule encoded here: a new CRM capability
// does NOT automatically become a permanent sidebar item. Views (Pipeline),
// activity lists (Tasks, Calls…), configuration pages (stages, territories,
// assignment…), imports and duplicates belong to an existing workspace
// (`parent`). The sidebar is a small set of recurring workspaces.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getModuleNavigation } from "./module-navigation-registry.ts";
import {
  activeWorkspaceId,
  allItems,
  breadcrumbTrail,
  sidebarItems,
  workspaceChildren,
} from "./navigation-resolution.ts";
import { permissionsForRole } from "../../../../../packages/permissions/src/roles.js";

const crm = getModuleNavigation("crm")!;
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../../app/(workspace)");
const everyone = { permissions: [], isOwner: true };
const role = (slug: string) => ({ permissions: [...permissionsForRole(slug)] });
const visible = (viewer: { permissions: string[]; isOwner?: boolean }) =>
  sidebarItems(crm, viewer).map((section) => [
    section.label,
    section.items.map((item) => item.label),
  ]);

test("the CRM sidebar is exactly the approved workspaces", () => {
  assert.deepEqual(visible(everyone), [
    ["Overview", ["Home"]],
    ["Customers", ["Leads", "Accounts", "Contacts"]],
    ["Sales", ["Opportunities"]],
    ["Work", ["My Work"]],
    ["Insights", ["Forecast", "Reports"]],
    ["Administration", ["CRM Setup"]],
  ]);
});

test("sidebar bloat guard: every other CRM route belongs to a workspace", () => {
  const items = allItems(crm);
  const workspaces = items.filter((item) => !item.parent);
  assert.ok(
    workspaces.length <= 9,
    `${workspaces.length} permanent CRM destinations`,
  );
  const workspaceIds = new Set(workspaces.map((item) => item.id));
  for (const item of items.filter((candidate) => candidate.parent))
    assert.ok(
      workspaceIds.has(item.parent!),
      `${item.label} points at unknown workspace ${item.parent}`,
    );
  const ids = items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, "item ids are unique");
});

test("hidden CRM routes stay registered (search, breadcrumbs, deep links)", () => {
  const routes = new Set(allItems(crm).map((item) => item.route));
  for (const route of [
    "/crm/dashboard",
    "/crm/pipeline",
    "/crm/tasks",
    "/crm/calls",
    "/crm/meetings",
    "/crm/follow-ups",
    "/crm/communications",
    "/crm/coverage",
    "/crm/data/import-export",
    "/crm/data/duplicates",
    "/crm/settings/assignment",
    "/crm/settings/territories",
    "/crm/settings/pipeline-stages",
    "/crm/settings/lost-reasons",
    "/crm/settings/playbooks",
    "/crm/settings/lead-lifecycle",
    "/crm/settings/lead-sources",
    "/crm/settings/lead-scoring",
    "/crm/settings/duplicate-rules",
    "/crm/settings/custom-fields-and-tags",
    "/crm/settings/record-fields",
    "/crm/settings/meeting-links",
    "/crm/settings/data-requests",
  ])
    assert.ok(routes.has(route), `${route} is registered`);
});

test("every registered CRM route is a real page (no placeholder destinations)", () => {
  for (const item of allItems(crm)) {
    const file = path.join(
      appDir,
      ...item.route.split("/").filter(Boolean),
      "page.tsx",
    );
    assert.ok(fs.existsSync(file), `${item.route} has no page (${file})`);
  }
});

test("route ownership: each route highlights exactly its canonical workspace", () => {
  const expected: Array<[string, string]> = [
    ["/crm", "home"],
    ["/crm/dashboard", "home"],
    ["/crm/leads", "leads"],
    ["/crm/leads/0b6f2a3c-1111-4111-8111-111111111111", "leads"],
    ["/crm/leads/new", "leads"],
    ["/crm/accounts/x/edit", "accounts"],
    ["/crm/contacts/x", "contacts"],
    ["/crm/opportunities", "opportunities"],
    ["/crm/opportunities/x/edit", "opportunities"],
    ["/crm/pipeline", "opportunities"],
    ["/crm/work", "my-work"],
    ["/crm/tasks", "my-work"],
    ["/crm/tasks/new", "my-work"],
    ["/crm/tasks/x", "my-work"],
    ["/crm/calls/x", "my-work"],
    ["/crm/meetings", "my-work"],
    ["/crm/follow-ups/new", "my-work"],
    ["/crm/communications", "my-work"],
    ["/crm/forecast", "forecast"],
    ["/crm/reports", "reports"],
    ["/crm/settings", "crm-setup"],
    ["/crm/settings/territories", "crm-setup"],
    ["/crm/settings/assignment", "crm-setup"],
    ["/crm/settings/privacy", "crm-setup"],
    ["/crm/coverage", "crm-setup"],
    ["/crm/data/import-export", "crm-setup"],
    ["/crm/data/duplicates", "crm-setup"],
  ];
  for (const [route, workspace] of expected)
    assert.equal(activeWorkspaceId(crm, route), workspace, route);
});

test("permissions: sellers get the working set, admins also get CRM Setup", () => {
  assert.deepEqual(
    visible(role("sales_representative")).flatMap(([, labels]) => labels),
    [
      "Home",
      "Leads",
      "Accounts",
      "Contacts",
      "Opportunities",
      "My Work",
      "Forecast",
      "Reports",
    ],
  );
  for (const slug of ["crm_administrator", "sales_operations"])
    assert.ok(
      visible(role(slug)).some(([, labels]) =>
        (labels as string[]).includes("CRM Setup"),
      ),
      `${slug} sees CRM Setup`,
    );
  // A CRM user with none of the gated permissions sees neither Insights nor Setup.
  assert.deepEqual(
    visible({ permissions: ["crm.view"] }).flatMap(([, labels]) => labels),
    ["Home", "Leads", "Accounts", "Contacts", "Opportunities", "My Work"],
  );
});

test("CRM Setup lists only destinations the viewer may open", () => {
  const admin = workspaceChildren(
    crm,
    "crm-setup",
    role("crm_administrator"),
  ).map((item) => item.route);
  assert.ok(admin.includes("/crm/settings/territories"));
  assert.ok(admin.includes("/crm/settings/data-requests"));
  const manager = workspaceChildren(
    crm,
    "crm-setup",
    role("sales_manager"),
  ).map((item) => item.route);
  assert.ok(manager.includes("/crm/coverage"));
  assert.ok(
    !manager.includes("/crm/settings/assignment"),
    "assignment needs crm.settings.manage",
  );
  for (const item of allItems(crm).filter(
    (candidate) => candidate.parent === "crm-setup",
  ))
    assert.ok(
      crm.groups?.some((group) => group.id === item.group),
      `${item.label} has a CRM Setup category`,
    );
});

test("breadcrumbs follow workspace ownership", () => {
  const labels = (route: string) =>
    breadcrumbTrail(crm, route).map((crumb) => crumb.label);
  assert.deepEqual(labels("/crm"), ["CRM"]);
  assert.deepEqual(labels("/crm/leads/x"), ["CRM", "Leads"]);
  assert.deepEqual(labels("/crm/pipeline"), [
    "CRM",
    "Opportunities",
    "Pipeline",
  ]);
  assert.deepEqual(labels("/crm/tasks"), ["CRM", "My Work", "Tasks"]);
  assert.deepEqual(labels("/crm/settings"), ["CRM", "CRM Setup"]);
  assert.deepEqual(labels("/crm/settings/territories"), [
    "CRM",
    "CRM Setup",
    "Routing & organization",
    "Territories & Sales Teams",
  ]);
  assert.deepEqual(labels("/crm/reports"), ["CRM", "Reports"]);
});
