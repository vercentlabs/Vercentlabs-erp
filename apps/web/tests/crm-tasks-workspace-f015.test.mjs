// CRM vNext Prompt 6 (F015 — Tasks), final closeout pass: the dossier
// requires a real Tasks workspace (My Tasks/Team-Queue/claim/release/
// recurrence/dependency UI, canonical Experience Kernel components) —
// "Do not use a generic resource manager." Before this pass, Tasks fell
// through to CrmResourceManager exactly like every other unhandled
// activityType. These are source-level assertions (not a browser test —
// see tests/e2e/erp-crm-tasks-queue.spec.ts for the real browser journey)
// proving the wiring exists and the generic fallback is bypassed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const page = read("src/modules/crm/seller-activity-and-follow-up-workspace/activity-workspace-page.tsx");
const workspace = read("src/modules/crm/seller-activity-and-follow-up-workspace/tasks-workspace.tsx");

test("F015: the Activities page routes activityType=task to TasksWorkspace before it ever reaches the generic resource-manager fallback", () => {
  assert.match(page, /import TasksWorkspace from "@\/modules\/crm\/seller-activity-and-follow-up-workspace\/tasks-workspace"/);
  const taskBranchIndex = page.indexOf('if (activityType === "task")');
  const genericFallbackIndex = page.indexOf("<CrmResourceManager");
  assert.ok(taskBranchIndex > -1, "a dedicated task branch must exist");
  assert.ok(taskBranchIndex < genericFallbackIndex, "the task branch must return before the generic CrmResourceManager fallback is reached");
  assert.match(page, /<TasksWorkspace/);
});

test("F015: the Activities page fetches Tasks through listCrmTasks/listMyTaskTeams, not the generic listCrmRecords, for the task branch", () => {
  const taskBranch = page.slice(page.indexOf('if (activityType === "task")'), page.indexOf("const result = await tenantTransaction"));
  assert.match(taskBranch, /listCrmTasks\(client, context, \{/);
  assert.match(taskBranch, /listMyTaskTeams\(client, context\)/);
  assert.doesNotMatch(taskBranch, /listCrmRecords\(client, context, "activities"/);
});

test("F015: TasksWorkspace uses the canonical EnterpriseDataGrid/Dialog/ConfirmDialog Experience Kernel components, not raw markup", () => {
  assert.match(workspace, /EnterpriseDataGrid/);
  assert.match(workspace, /from "@\/shared\/design"/);
  assert.match(workspace, /<Dialog /);
  assert.match(workspace, /<ConfirmDialog/);
});

test("F015 §2/§13 closeout: the workspace supports My Tasks, Team/Queue Tasks, and an authorized-all view, plus status/due/search/parent-record/recurrence/dependency/provenance surfaces", () => {
  assert.match(workspace, /My Tasks/);
  assert.match(workspace, /Team\/Queue Tasks/);
  assert.match(workspace, /All authorized Tasks/);
  assert.match(workspace, /RELATION_OPTIONS/); // parent CRM record linking
  assert.match(workspace, /describeRecurrence/);
  assert.match(workspace, /DependencySection/);
  assert.match(workspace, /Auto-generated/); // generated-task provenance badge
});

test("F015 §5 closeout: recurrence UI renders human-readable text, never raw JSON, for the dossier's own worked examples", () => {
  assert.match(workspace, /"Every weekday"/);
  assert.match(workspace, /Monthly on \$\{dayLabel\}/);
  assert.doesNotMatch(workspace, /JSON\.stringify\(.*recurrenceConfig/);
});

test("F015 §4 closeout: a claim conflict (409) is presented as an understandable message, not surfaced as a raw/generic failure", () => {
  const claimFn = workspace.match(/async function claim\([\s\S]*?\n  \}/)?.[0] || "";
  assert.match(claimFn, /Someone else just claimed this Task/);
});

test("F015 §3 closeout: the create/edit form exposes title, parent record, assignment (me\\/person\\/queue), due date, priority, recurrence and description", () => {
  const formFn = workspace.slice(workspace.indexOf("function TaskForm("));
  for (const field of ["task-form-subject", "task-form-entity-type", "task-form-entity-id", "task-form-priority", "task-form-due-at", "task-form-description", "task-form-recurrence-freq"]) {
    assert.match(formFn, new RegExp(field), `TaskForm must expose ${field}`);
  }
  assert.match(formFn, /Assign to me/);
  assert.match(formFn, /Assign to a person/);
  assert.match(formFn, /Queue to a Team/);
});

test("F015: the team-member picker route requires an active Team membership (or view-all) before exposing the roster", () => {
  const domain = read("../../services/api/src/modules/crm/seller-activity-and-follow-up-workspace/task-operations.js");
  const fn = domain.match(/export async function listTeamMembers[\s\S]*?\n\}/)?.[0] || "";
  assert.match(fn, /canManageAllTasks\(context\)/);
  assert.match(fn, /isActiveTeamMember\(client, context, id, context\.userId\)/);
});
