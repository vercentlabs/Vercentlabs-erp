import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("CRM dashboard exposes complete creation journeys", () => {
  const dashboard = read("apps/web/src/app/(app)/crm/page.tsx");
  for (const marker of [
    "Create lead",
    "New opportunity",
    "Schedule activity",
    "/crm/leads?create=1",
    "/crm/opportunities?create=1",
    "/crm/activities?create=1",
  ]) assert.ok(dashboard.includes(marker), marker);
});

test("CRM metrics navigate to the relevant workspace", () => {
  const dashboard = read("apps/web/src/app/(app)/crm/page.tsx");
  assert.ok(dashboard.includes("primaryMetrics.map"));
  assert.ok(dashboard.includes("href={metric.href}"));
  for (const route of ["/crm/pipeline", "/crm/reports", "/crm/leads"]) {
    assert.ok(dashboard.includes(route), route);
  }
});

test("desktop and mobile web navigation expose released CRM workspaces", () => {
  const shell = read("apps/web/src/components/app-shell.tsx");
  for (const route of [
    "/crm/leads",
    "/crm/opportunities",
    "/crm/activities",
    "/crm/pipeline",
    "/crm/reports",
    "/crm/settings",
  ]) assert.ok(shell.includes(route), route);
  assert.ok(shell.includes("const visibleModules = moduleNavigation"));
  assert.ok(shell.includes("visibleModules.map"));
  assert.ok(shell.includes("navigation(true)"));
});

test("create query is passed into the generic CRM editor", () => {
  const page = read("apps/web/src/app/(app)/crm/[resource]/page.tsx");
  const manager = read("apps/web/src/components/crm-resource-manager.tsx");
  assert.ok(page.includes('query.create === "1"'));
  assert.ok(manager.includes("startCreating && canManage"));
});

test("pipeline exposes opportunity creation and table journeys", () => {
  const pipeline = read("apps/web/src/app/(app)/crm/pipeline/page.tsx");
  assert.ok(pipeline.includes("Create opportunity"));
  assert.ok(pipeline.includes("View opportunity table"));
});

test("CRM empty states contain the next action", () => {
  const dashboard = read("apps/web/src/app/(app)/crm/page.tsx");
  const manager = read("apps/web/src/components/crm-resource-manager.tsx");
  assert.ok(dashboard.includes("Create activity"));
  assert.ok(manager.includes("Add {definition.singular}"));
});

test("native dashboard exposes opportunity and activity creation", () => {
  const candidates = [
    "apps/mobile/src/shared/components/workspace-page.tsx",
    "apps/mobile/src/shared/components/resource-manager-screen.tsx",
    "apps/mobile/src/shared/components/workspace-area-screen.tsx",
  ];
  const path = candidates.find(fs.existsSync);
  assert.ok(path, "mobile CRM dashboard component");
  const source = read(path);
  assert.ok(source.includes("Create opportunity"));
  assert.ok(source.includes("Create activity"));
});
