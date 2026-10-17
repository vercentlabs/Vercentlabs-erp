// Projects — Assignees, the commands: the one way a task changes hands (the task page, lists, the board, milestones, the team view and bulk
// changes all use it), and what happens to someone's work when they leave the project. A reassignment says why and is recorded (from whom,
// to whom, by whom, the versions); the task's status, checklist, files, comments, due date, milestone, review and progress stay as they are,
// and time or expenses recorded by the previous assignee stay theirs. A done or cancelled task keeps its assignee.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { PROJECT, has, isoDay, projectError, registerMemberLeaveHook, text } from "../project-core.js";
import { taskScope } from "../project-task-read.js";
import { TASK_ENTITY } from "../project-task-rules.js";
import { isProjectClosed, notifyTask, replayTaskCommand, taskEvent, writeTask } from "../project-tasks.js";
import { ASSIGNMENT_REASONS, OPEN_TASK_STATUSES_SQL, projectContributor } from "./assignee-rules.js";
import { PRIORITY_LABEL } from "../priority/priority-rules.js";

const err = (status, code, message, details) => projectError(status, code, message, details);
const day = (value) => (value ? isoDay(value) : null);
const keyOf = (input) => text(input.idempotencyKey, 200) || null;

// input: { assigneeUserId, reasonCode?, reasonText? (or note), expectedVersion?, idempotencyKey?, notify? }
export async function assignProjectTask(client, c, taskId, input = {}) {
  const done = await replayTaskCommand(client, c, keyOf(input));
  if (done) return done;
  const { task, project, can } = await taskScope(client, c, taskId, { lock: true });
  if (!can.assign) throw err(403, "TASK_PERMISSION_DENIED");
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(task.row_version)) throw err(409, "ASSIGNEE_VERSION_CONFLICT");
  if (isProjectClosed(project)) throw err(409, "ASSIGNEE_PROJECT_STATUS_INVALID");
  if (["DONE", "CANCELLED"].includes(task.status)) throw err(409, "ASSIGNEE_TASK_STATUS_INVALID", `A ${task.status === "DONE" ? "done" : "cancelled"} task keeps its assignee; reopen it, or create a new task.`);
  const assignee = await projectContributor(client, c, project, input.assigneeUserId);
  if (assignee === task.assignee_user_id) throw err(409, "ASSIGNEE_TASK_ALREADY_ASSIGNED");
  // Whoever does the work does not also approve it (unless the company allows self-review).
  if (task.review_required && task.reviewer_user_id === assignee) {
    const self = (await client.query(`SELECT task_self_review_allowed FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]?.task_self_review_allowed ?? false;
    if (!self) throw err(409, "ASSIGNEE_REVIEWER_CONFLICT", "This person reviews the task; choose someone else, or change the reviewer first.");
  }
  const reasonCode = input.reasonCode ? String(input.reasonCode).toUpperCase() : null;
  if (reasonCode && !ASSIGNMENT_REASONS[reasonCode]) throw err(400, "TASK_INPUT_INVALID", "Choose why the task is reassigned.", { field: "reasonCode" });
  const reasonText = text(input.reasonText ?? input.note, 500) || null;
  if ((!reasonCode || reasonCode === "OTHER") && (!reasonText || reasonText.length < 3)) throw err(400, "ASSIGNEE_REASON_REQUIRED", undefined, { field: "reasonText" });
  const row = await writeTask(client, c, task, { assignee_user_id: assignee });
  await taskEvent(client, c, row, "REASSIGNED", `Reassigned${reasonText ? `: ${reasonText}` : reasonCode ? `: ${ASSIGNMENT_REASONS[reasonCode]}` : ""}`, { key: keyOf(input),
    details: { from: task.assignee_user_id, to: assignee, reasonCode, reasonText, versionBefore: task.row_version, versionAfter: row.row_version, inReview: task.status === "IN_REVIEW" } });
  if (input.notify !== false) {
    // Urgent and High work says so in the notice.
    const important = ["URGENT", "HIGH"].includes(row.priority) ? PRIORITY_LABEL[row.priority] : null;
    await notifyTask(client, c, row, [assignee], { title: `${important ? `${important} task` : "Task"} assigned to you: ${row.task_code}`,
      message: `${row.title} — due ${day(row.due_date)}${important ? `, ${important} priority` : ""}.` });
    await notifyTask(client, c, row, [task.assignee_user_id, project.manager_user_id].filter((id) => id !== assignee), { title: `${row.task_code} was reassigned`, message: row.title });
  }
  return { taskId: row.id, assigneeUserId: assignee, previousAssigneeUserId: task.assignee_user_id, version: row.row_version, status: row.status };
}

// After a bulk reassignment: the new assignee is told once, with the count — never once per task, and never for a repeat.
export async function announceBulkAssignment(client, c, assigneeUserId, results) {
  const fresh = results.filter((row) => row.ok && !row.replayed);
  if (!fresh.length || !assigneeUserId || assigneeUserId === c.userId) return;
  await createNotification(client, { organizationId: c.organizationId, userId: assigneeUserId, category: "project_task", title: `${fresh.length} task(s) assigned to you`,
    message: fresh.map((row) => row.code).slice(0, 10).join(", "), href: "/projects/tasks?view=mine", entityType: TASK_ENTITY, entityId: null });
}

// When someone leaves the team: the reviews they would have done fall back to the Project Manager; their open tasks go to a named person
// (input.reassignToUserId, their active blockers with them) or stay with them by an authorized exception (input.taskException), which puts the
// tasks in the "needs an owner" queue and tells the manager. Otherwise they cannot leave.
registerMemberLeaveHook(async (client, c, project, userId, input) => {
  const open = (await client.query(`SELECT * FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = $2 AND assignee_user_id = $3 AND status IN ${OPEN_TASK_STATUSES_SQL}`,
    [c.organizationId, project.id, userId])).rows;
  const reviewing = (await client.query(`SELECT * FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = $2 AND reviewer_user_id = $3 AND status IN ${OPEN_TASK_STATUSES_SQL}`,
    [c.organizationId, project.id, userId])).rows;
  for (const task of reviewing) {
    const row = await writeTask(client, c, task, { reviewer_user_id: null });
    await taskEvent(client, c, row, "UPDATED", "Reviewer left the project: the Project Manager reviews it", { details: { fields: ["reviewer"], from: userId } });
  }
  if (!open.length) return;
  if (input.reassignToUserId) {
    if (input.reassignToUserId === userId) throw err(400, "TASK_ASSIGNEE_INVALID", "Reassign the tasks to someone else.");
    for (const task of open) await assignProjectTask(client, c, task.id, { assigneeUserId: input.reassignToUserId, reasonCode: "LEFT_PROJECT", reasonText: "The previous assignee left the project" });
    await client.query(`UPDATE tenant.project_task_blockers SET owner_user_id = $4 WHERE organization_id = $1 AND owner_user_id = $3 AND status = 'ACTIVE'
       AND task_id IN (SELECT id FROM tenant.project_tasks WHERE project_id = $2)`, [c.organizationId, project.id, userId, input.reassignToUserId]);
    return;
  }
  if (input.taskException) {
    const reason = text(input.taskException, 2000);
    if (reason.length < 3) throw err(400, "TASK_REASON_REQUIRED", "Say why the open tasks stay with this person.");
    if (!has(c, PROJECT.taskAssign)) throw err(403, "TASK_PERMISSION_DENIED");
    for (const task of open) await taskEvent(client, c, task, "ASSIGNEE_LEFT", `The assignee left the project; kept by exception: ${reason}`, { details: { reason } });
    await notifyTask(client, c, open[0], [project.manager_user_id], { title: `${open.length} task(s) need a new owner`, message: `Their assignee left ${project.project_code}: ${reason}` });
    return;
  }
  throw err(409, "ASSIGNEE_MEMBER_HAS_OPEN_WORK", undefined, { tasks: open.map((row) => ({ id: row.id, code: row.task_code, title: row.title, status: row.status })) });
});
