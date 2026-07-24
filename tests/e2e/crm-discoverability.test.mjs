import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("CRM dashboard exposes complete creation journeys", () => {
  const dashboard = read("apps/web/src/app/(app)/crm/page.tsx");
  for (const marker of [
    "Create lead",
    "Create opportunity",
    "Create activity",
    "/crm/leads?create=1",
    "/crm/opportunities?create=1",
    "/crm/activities?create=1",
  ]) assert.ok(dashboard.includes(marker), marker);
});

test("CRM metrics navigate to the relevant workspace", () => {
  const dashboard = read("apps/web/src/app/(app)/crm/page.tsx");
  assert.match(dashboard, /aria-label={`Open \${String\(label\)}`}/);
  assert.ok(dashboard.includes('hint === "opportunities"'));
  assert.ok(dashboard.includes('hint === "overdue"'));
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
  assert.ok(shell.includes("visibleCrm"));
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
