// Projects — Priority, the changes: how a project, milestone or task gets a new priority. Each record's edit command asks here for the change
// a request makes (refusing done, completed or cancelled work, and asking why for a move to or from Urgent), writes only its own priority, and
// hands the change back here to be recorded (who, when, from, to, why, the versions) and announced. Nothing else on the record — or on its
// parent or children — moves. The three priority commands are the same edits with nothing but the priority, answering in the PRIORITY_* terms.
import { isoDay, projectError, projectEvent, text, visibleProject } from "../project-core.js";
import { milestoneEvent, updateProjectMilestone } from "../project-milestones.js";
import { milestoneScope } from "../project-milestone-read.js";
import { MILESTONE_ENTITY } from "../project-milestone-rules.js";
import { updateProject } from "../project-service.js";
import { taskScope } from "../project-task-read.js";
import { TASK_ENTITY } from "../project-task-rules.js";
import { replayTaskCommand, taskEvent, updateProjectTask } from "../project-tasks.js";
import { PRIORITY_LABEL, notifyPriorityChange, priorityAudience, priorityChangeOf, priorityHeadline, prioritySummary, validatePriority } from "./priority-rules.js";

const err = (status, code, message, details) => projectError(status, code, message, details);

// The change an edit makes to a record's priority, or null when it keeps it. completedStatus: DONE for tasks, COMPLETED for milestones and projects.
export function priorityChangeFor(record, input, completedStatus) {
  if (input.priority === undefined) return null;
  const to = validatePriority(input.priority, record.priority);
  if (to === record.priority) return null;
  if (record.status === completedStatus) throw err(409, "PRIORITY_RECORD_COMPLETED");
  if (record.status === "CANCELLED") throw err(409, "PRIORITY_RECORD_CANCELLED");
  return priorityChangeOf(record.priority, to, input.priorityReason ?? input.changeReason);
}

const details = (change, before, after, extra = {}) => ({ from: change.from, to: change.to, reason: change.reason, versionBefore: before, versionAfter: after, ...extra });

// After a task's edit wrote its new priority: the history, then the assignee (and, for Urgent, the manager) — unless a bulk change tells them once.
export async function recordTaskPriorityChange(client, c, { task, row, project, change, key = null, notify = true }) {
  await taskEvent(client, c, row, "PRIORITY_CHANGED", prioritySummary(change), { details: { ...details(change, task.row_version, row.row_version), result: { priority: change.to, version: row.row_version } }, key });
  if (!notify) return;
  await notifyPriorityChange(client, c, priorityAudience(change, { worker: row.assignee_user_id, manager: project.manager_user_id }), {
    category: "project_task", title: priorityHeadline(row.task_code, change), message: `${row.title} (${project.project_code}), due ${isoDay(row.due_date)}${change.reason ? `. ${change.reason}` : ""}`,
    href: `/projects/tasks/${row.id}`, entityType: TASK_ENTITY, entityId: row.id });
}
export async function recordMilestonePriorityChange(client, c, { milestone, row, project, change, key = null }) {
  await milestoneEvent(client, c, row, "PRIORITY_CHANGED", prioritySummary(change), { details: { ...details(change, milestone.row_version, row.row_version), result: { priority: change.to, version: row.row_version } }, key });
  await notifyPriorityChange(client, c, priorityAudience(change, { worker: row.owner_user_id, manager: project.manager_user_id }), {
    category: "project_milestone", title: priorityHeadline(row.milestone_code, change), message: `${row.name} (${project.project_code}), due ${isoDay(row.current_due_date)}${change.reason ? `. ${change.reason}` : ""}`,
    href: `/projects/milestones/${row.id}`, entityType: MILESTONE_ENTITY, entityId: row.id });
}
export async function recordProjectPriorityChange(client, c, { project, managerUserId, name, change, key = null }) {
  await projectEvent(client, c, project.id, "PRIORITY_CHANGED", prioritySummary(change), details(change, project.row_version, project.row_version + 1, { key }));
  if (project.status === "DRAFT") return;
  await notifyPriorityChange(client, c, priorityAudience(change, { worker: managerUserId, manager: null }), {
    category: "project_update", title: priorityHeadline(project.project_code, change), message: `${name ?? "The project"}${change.reason ? `. ${change.reason}` : ""}`,
    href: `/projects/${project.id}`, entityType: "projects.project", entityId: project.id });
}

const required = (input) => {
  if (input.priority === undefined || input.priority === null || input.priority === "") throw err(400, "PRIORITY_INVALID", undefined, { field: "priority" });
  return validatePriority(input.priority);
};
const stale = (input, version) => input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(version);
const reasonOf = (input) => input.reason ?? input.changeReason ?? input.priorityReason;
const keyOf = (input) => text(input.idempotencyKey, 200) || null;

// input (all three): { priority, reason?, expectedVersion?, idempotencyKey? }; a task also takes notify (false in bulk changes).
export async function updateTaskPriority(client, c, taskId, input = {}) {
  const done = await replayTaskCommand(client, c, keyOf(input));
  if (done) return done;
  let scope;
  try { scope = await taskScope(client, c, taskId); } catch (failure) { if (failure?.code === "TASK_NOT_FOUND") throw err(404, "PRIORITY_RECORD_NOT_FOUND"); throw failure; }
  const { task, can } = scope;
  if (!can.edit) throw err(403, "PRIORITY_PERMISSION_DENIED");
  if (stale(input, task.row_version)) throw err(409, "PRIORITY_VERSION_CONFLICT");
  const priority = required(input);
  const result = await updateProjectTask(client, c, taskId, { priority, priorityReason: reasonOf(input), expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey, notify: input.notify });
  return { taskId, priority: result.priority ?? task.priority, version: result.version, changed: (result.changed ?? []).includes("priority") };
}

export async function updateMilestonePriority(client, c, milestoneId, input = {}) {
  let scope;
  try { scope = await milestoneScope(client, c, milestoneId); } catch (failure) { if (failure?.code === "MILESTONE_NOT_FOUND") throw err(404, "PRIORITY_RECORD_NOT_FOUND"); throw failure; }
  const { milestone, can } = scope;
  if (!can.edit) throw err(403, "PRIORITY_PERMISSION_DENIED");
  const replayed = keyOf(input) ? (await client.query(`SELECT details FROM tenant.project_milestone_events WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, keyOf(input)])).rows[0] : null;
  if (replayed) return { milestoneId, priority: replayed.details?.result?.priority ?? milestone.priority, version: replayed.details?.result?.version ?? milestone.row_version, changed: true, replayed: true };
  if (stale(input, milestone.row_version)) throw err(409, "PRIORITY_VERSION_CONFLICT");
  const priority = required(input);
  const result = await updateProjectMilestone(client, c, milestoneId, { priority, priorityReason: reasonOf(input), expectedVersion: input.expectedVersion, idempotencyKey: input.idempotencyKey });
  return { milestoneId, priority: result.priority ?? milestone.priority, version: result.version, changed: (result.changed ?? []).includes("priority") };
}

export async function updateProjectPriority(client, c, projectId, input = {}) {
  let scope;
  try { scope = await visibleProject(client, c, projectId); } catch (failure) { if (failure?.code === "PROJECT_NOT_FOUND") throw err(404, "PRIORITY_RECORD_NOT_FOUND"); throw failure; }
  const { project, access } = scope;
  if (!access.can.edit) throw err(403, "PRIORITY_PERMISSION_DENIED");
  const key = keyOf(input);
  const replayed = key ? (await client.query(`SELECT details FROM tenant.project_events WHERE organization_id = $1 AND action = 'PRIORITY_CHANGED' AND details->>'key' = $2`, [c.organizationId, key])).rows[0] : null;
  if (replayed) return { projectId, priority: replayed.details.to, version: replayed.details.versionAfter, changed: true, replayed: true };
  if (stale(input, project.row_version)) throw err(409, "PRIORITY_VERSION_CONFLICT");
  if (project.status === "COMPLETED") throw err(409, "PRIORITY_RECORD_COMPLETED");
  if (project.status === "CANCELLED") throw err(409, "PRIORITY_RECORD_CANCELLED");
  const priority = required(input);
  const result = await updateProject(client, c, projectId, { priority, priorityReason: reasonOf(input), expectedVersion: input.expectedVersion, idempotencyKey: key });
  return { projectId, priority: result.priority ?? project.priority, version: result.version, changed: (result.changed ?? []).includes("priority") };
}

// After a bulk priority change: work that became Urgent (or stopped being Urgent) is announced to each assignee once, with the count — never
// once per task, and never for a repeated request. results: the bulk command's per-task results (ok, replayed, changed).
export async function announceBulkPriority(client, c, priority, reason, results) {
  const to = String(priority ?? "").toUpperCase();
  const ids = results.filter((row) => row.ok && !row.replayed && row.changed).map((row) => row.taskId);
  if (!ids.length) return;
  const rows = (await client.query(`SELECT task.task_code, task.assignee_user_id,
      (SELECT event.details->>'from' FROM tenant.project_task_events event WHERE event.task_id = task.id AND event.action = 'PRIORITY_CHANGED' ORDER BY event.occurred_at DESC LIMIT 1) AS was
     FROM tenant.project_tasks task WHERE task.organization_id = $1 AND task.id = ANY($2::uuid[])`, [c.organizationId, ids])).rows
    .filter((row) => to === "URGENT" || row.was === "URGENT");
  const byPerson = new Map();
  for (const row of rows) byPerson.set(row.assignee_user_id, [...(byPerson.get(row.assignee_user_id) ?? []), row.task_code]);
  for (const [userId, codes] of byPerson) {
    await notifyPriorityChange(client, c, [userId], { category: "project_task",
      title: to === "URGENT" ? `${codes.length} task(s) are now Urgent` : `${codes.length} task(s) are no longer Urgent (now ${PRIORITY_LABEL[to] ?? to})`,
      message: `${codes.slice(0, 10).join(", ")}${reason ? `. ${text(reason, 500)}` : ""}`, href: "/projects/tasks?view=mine", entityType: TASK_ENTITY, entityId: `bulk:${to}` });
  }
}
