import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

// CRM vNext Prompt 6 (F015 — Tasks). `start`/`cancel`/`history` already
// had dedicated routes; `complete` was the one missing sibling — this
// closes that asymmetry. Dependencies are an entirely new capability with
// no generic-route equivalent to reuse.

test("F015: the dedicated Task complete route exists, governed the same way as its start/cancel siblings", () => {
  const source = read("apps/web/src/app/api/crm/tasks/[id]/complete/route.ts");
  assert.match(source, /completeCrmTask/);
  assert.match(source, /assertSameOrigin/);
  assert.match(source, /crmActivitiesManage/);
  assert.match(source, /requireBillingWriteAccess/);
  assert.match(source, /crm\.task\.completed/);
});

test("F015: the Task dependencies list/add route is governed and uses the real cycle-preventing domain function", () => {
  const source = read("apps/web/src/app/api/crm/tasks/[id]/dependencies/route.ts");
  assert.match(source, /listTaskDependencies/);
  assert.match(source, /addTaskDependency/);
  assert.match(source, /requirePermissionFromSession\(session, PERMISSIONS\.crmView\)/);
  assert.match(source, /requirePermissionFromSession\(session, PERMISSIONS\.crmActivitiesManage\)/);
  assert.match(source, /assertSameOrigin/);
});

test("F015: the Task dependency-removal route is governed the same way as every other destructive Task action", () => {
  const source = read("apps/web/src/app/api/crm/tasks/[id]/dependencies/[dependsOnTaskId]/route.ts");
  assert.match(source, /removeTaskDependency/);
  assert.match(source, /assertSameOrigin/);
  assert.match(source, /crmActivitiesManage/);
});

test("F015: the generic Activity complete route is unmodified — the new dedicated route is an addition, not a redirect", () => {
  const shared = read("apps/web/src/app/api/crm/activities/[id]/complete/route.ts");
  assert.match(shared, /completeCrmTask/);
});
