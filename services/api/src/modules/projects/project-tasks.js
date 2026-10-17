// Projects — Tasks, the commands: a task created (once per request, optionally from a template snapshot), edited, assigned, moved through its
// lifecycle by one transition authority (the task page, the board and bulk changes all go through it), its checklist kept, its earlier tasks
// and blockers recorded, submitted for review as an immutable snapshot and decided, completed once every requirement holds, reopened with a
// reason, cancelled after reviewing what depends on it, archived; plus comments with mentions, files, saved views and bulk changes. Every
// change is versioned, recorded in the task's history and announced to automation. A task never creates time entries, expenses, invoices or
// postings — those modules keep their own records.
import { publishDomainEvent } from "../../core/platform/events/index.js";
import { archiveFile, listFiles, readFileContent, storeFile } from "../../core/platform/files/index.js";
import { createNotification } from "../../core/platform/notifications/index.js";
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { PROJECT, has, isoDay, progressChanged, projectError, text, userNames, uuid } from "./project-core.js";
import { announceBulkAssignment, assignProjectTask, projectContributor } from "./assignees/index.js";
import { announceBulkPriority, priorityChangeFor, recordTaskPriorityChange, updateTaskPriority, validatePriority } from "./priority/index.js";
import {
  checklistOf, currentDecisionOf, projectTaskScope, taskDependentsOf, taskFilesOf, taskPrerequisitesOf, taskReadinessFor, taskScope,
} from "./project-task-read.js";
import { BLOCKER_REASONS, TASK_ENTITY, TASK_STATUS_LABEL, TASK_TYPES, createsTaskCycle } from "./project-task-rules.js";
import { executionState } from "./status/status-rules.js";

const err = (status, code, message, details) => projectError(status, code, message, details);
const need = (can, key) => { if (!can[key]) throw err(403, "TASK_PERMISSION_DENIED"); };
const day = (value) => (value ? isoDay(value) : null);
const keyOf = (input) => text(input.idempotencyKey, 200) || null;
const reasonOf = (value, message = "Give a reason.") => {
  const reason = text(value, 2000);
  if (reason.length < 3) throw err(400, "TASK_REASON_REQUIRED", message);
  return reason;
};
const versionCheck = (task, expected) => {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(task.row_version)) throw err(409, "TASK_VERSION_CONFLICT");
};
const dateOf = (value, field = "dueDate") => {
  try { return isoDay(value); } catch { throw err(400, "TASK_DUE_DATE_INVALID", undefined, { field }); }
};
const enumOf = (value, allowed, fallback, message, field) => {
  if (value === undefined || value === null || value === "") return fallback;
  const upper = String(value).toUpperCase();
  if (!allowed.includes(upper)) throw err(400, "TASK_INPUT_INVALID", message, { field });
  return upper;
};
const tagsOf = (value) => {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  const tags = [...new Set(list.map((tag) => text(tag, 40).toLowerCase()).filter(Boolean))];
  if (tags.length > 20) throw err(400, "TASK_INPUT_INVALID", "Use at most 20 tags.", { field: "tags" });
  return tags;
};
const estimateOf = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1000000) throw err(400, "TASK_INPUT_INVALID", "Give the estimate in minutes (more than zero).", { field: "estimateMinutes" });
  return minutes;
};

// ------------------------------------------------------------------ history, notifications, automation
export async function taskEvent(client, c, task, action, summary, { from = null, to = null, details = {}, key = null } = {}) {
  await client.query(`INSERT INTO tenant.project_task_events (organization_id, task_id, project_id, action, summary, details, from_status, to_status, actor_user_id, idempotency_key)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)`,
    [c.organizationId, task.id, task.project_id, action, summary ? String(summary).slice(0, 1000) : null, JSON.stringify(details), from, to, c.userId ?? null, key]);
  if (to) await progressChanged(client, c, task.project_id, { type: "TASK", id: task.id, action, from, to });
  await publishDomainEvent(client, { organizationId: c.organizationId, moduleKey: "projects", eventType: `projects.task.${action.toLowerCase()}`, entityType: TASK_ENTITY, entityId: task.id,
    payload: { taskCode: task.task_code, projectId: task.project_id, status: to ?? task.status, assigneeUserId: task.assignee_user_id, milestoneId: task.milestone_id, ...details } });
}
// A command already applied under this key answers as it did, without doing it again.
async function replay(client, c, key) {
  if (!key) return null;
  const row = (await client.query(`SELECT task_id, to_status, details FROM tenant.project_task_events WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
  return row ? { taskId: row.task_id, status: row.to_status ?? undefined, replayed: true, ...(row.details?.result ?? {}) } : null;
}
// To the given people (never the actor), linked to the task.
async function notify(client, c, task, userIds, { category = "project_task", title, message }) {
  const users = new Set(userIds.filter(Boolean));
  users.delete(c.userId);
  for (const userId of users) {
    await createNotification(client, { organizationId: c.organizationId, userId, category, title, message, href: `/projects/tasks/${task.id}`, entityType: TASK_ENTITY, entityId: task.id });
  }
}
async function write(client, c, task, sets) {
  const columns = ["row_version = row_version + 1", "updated_by = $3", "updated_at = now()"];
  const values = [c.organizationId, task.id, c.userId ?? null];
  for (const [column, value] of Object.entries(sets)) { values.push(value); columns.push(`${column} = $${values.length}`); }
  return (await client.query(`UPDATE tenant.project_tasks SET ${columns.join(", ")} WHERE organization_id = $1 AND id = $2 RETURNING *`, values)).rows[0];
}
async function milestoneNote(client, c, milestoneId, action, summary) {
  const milestone = (await client.query(`SELECT id, project_id, owner_user_id, milestone_code FROM tenant.project_milestones WHERE id = $1`, [milestoneId])).rows[0];
  if (!milestone) return null;
  await client.query(`INSERT INTO tenant.project_milestone_events (organization_id, milestone_id, project_id, action, summary, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    [c.organizationId, milestone.id, milestone.project_id, action, String(summary).slice(0, 1000), c.userId ?? null]);
  return milestone;
}

// ------------------------------------------------------------------ guards
const closed = (project) => executionState(project) === "CLOSED";
// What the project's status allows comes from Project Status (status/): planning (creating, editing, assigning, checklists, comments, files,
// cancelling) while the project is open — on Hold included; execution (starting, ticking the checklist, completing, submitting, approving)
// only while it is in progress.
function projectOpen(project) { if (executionState(project) === "CLOSED") throw err(409, "TASK_PROJECT_CLOSED"); }
function projectWorking(project) {
  const state = executionState(project);
  if (state === "CLOSED") throw err(409, "TASK_PROJECT_CLOSED");
  if (state === "ON_HOLD") throw err(409, "TASK_PROJECT_ON_HOLD");
  if (state === "NOT_STARTED") throw err(409, "TASK_PROJECT_NOT_STARTED");
}
function taskOpen(task) {
  if (task.status === "DONE") throw err(409, "TASK_ALREADY_COMPLETED");
  if (task.status === "CANCELLED") throw err(409, "TASK_STATUS_INVALID", "This task is cancelled.");
}
function readinessError(failing, checks) {
  const first = failing[0];
  const code = { checklist: "TASK_CHECKLIST_INCOMPLETE", evidence: "TASK_EVIDENCE_REQUIRED", dependencies: "TASK_DEPENDENCY_OPEN", blockers: "TASK_BLOCKER_ACTIVE", review: "TASK_REVIEW_REQUIRED",
    project: first.message.includes("Hold") ? "TASK_PROJECT_ON_HOLD" : "TASK_PROJECT_NOT_STARTED" }[first.key] ?? "TASK_STATUS_INVALID";
  return err(409, code, failing.map((row) => row.message).join(" "), { checks });
}
// A change to what is reviewed: refused while under review unless it is withdrawn; afterwards an earlier approval no longer counts.
async function changeScope(client, c, task, input, what) {
  taskOpen(task);
  if (task.status === "IN_REVIEW") {
    if (!input.withdrawReview) throw err(409, "TASK_IN_REVIEW");
    const row = await write(client, c, task, { status: "IN_PROGRESS", approval_status: "NOT_SUBMITTED", scope_version: task.scope_version + 1 });
    await taskEvent(client, c, row, "REVIEW_WITHDRAWN", `Withdrawn from review to change ${what}`, { from: "IN_REVIEW", to: "IN_PROGRESS" });
    return row;
  }
  return write(client, c, task, { scope_version: task.scope_version + 1, ...(task.approval_status === "APPROVED" ? { approval_status: task.review_required ? "NOT_SUBMITTED" : "NOT_REQUIRED" } : {}) });
}

// The milestone a task is filed under: one of this project's, still open to new work.
async function milestoneFor(client, c, project, milestoneId) {
  let id;
  try { id = uuid(milestoneId, "Milestone"); } catch { throw err(400, "TASK_MILESTONE_INVALID", undefined, { field: "milestoneId" }); }
  const row = (await client.query(`SELECT * FROM tenant.project_milestones WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0];
  if (!row || row.project_id !== project.id) throw err(400, "TASK_MILESTONE_INVALID", undefined, { field: "milestoneId" });
  if (!["NOT_STARTED", "IN_PROGRESS", "BLOCKED"].includes(row.status)) throw err(409, "TASK_MILESTONE_INVALID",
    row.status === "SUBMITTED" ? "That milestone is under review: its tasks are locked until the review ends." : "That milestone is closed to new tasks.", { field: "milestoneId" });
  return row;
}
// File the task under a milestone (or none): the milestone's task link follows, and the milestone's reviewed scope moves on.
async function fileUnder(client, c, task, project, milestoneId) {
  const target = milestoneId ? await milestoneFor(client, c, project, milestoneId) : null;
  if ((target?.id ?? null) === (task.milestone_id ?? null)) return task;
  const link = (await client.query(`SELECT link.*, milestone.status AS milestone_status, milestone.milestone_code FROM tenant.project_milestone_task_links link
     JOIN tenant.project_milestones milestone ON milestone.id = link.milestone_id WHERE link.organization_id = $1 AND link.task_id = $2 AND link.removed_at IS NULL`, [c.organizationId, task.id])).rows[0];
  if (link) {
    if (link.milestone_status === "SUBMITTED") throw err(409, "TASK_MILESTONE_INVALID", `${link.milestone_code} is under review: its tasks are locked until the review ends.`);
    await client.query(`UPDATE tenant.project_milestone_task_links SET removed_at = clock_timestamp(), removed_by = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, link.id, c.userId ?? null]);
    if (!["COMPLETED", "CANCELLED"].includes(link.milestone_status)) await client.query(`UPDATE tenant.project_milestones SET scope_version = scope_version + 1, row_version = row_version + 1, updated_at = now() WHERE id = $1`, [link.milestone_id]);
    await milestoneNote(client, c, link.milestone_id, "TASK_UNLINKED", `${task.task_code} ${task.title} moved off this milestone`);
  }
  if (target) {
    await client.query(`INSERT INTO tenant.project_milestone_task_links (organization_id, milestone_id, task_id, is_required, created_by) VALUES ($1,$2,$3,true,$4)`, [c.organizationId, target.id, task.id, c.userId ?? null]);
    await client.query(`UPDATE tenant.project_milestones SET scope_version = scope_version + 1, row_version = row_version + 1, updated_at = now() WHERE id = $1`, [target.id]);
    await milestoneNote(client, c, target.id, "TASK_LINKED", `${task.task_code} ${task.title} (required)`);
  }
  const row = await write(client, c, task, { milestone_id: target?.id ?? null });
  await taskEvent(client, c, row, target ? "MILESTONE_LINKED" : "MILESTONE_UNLINKED", target ? `Filed under ${target.milestone_code} ${target.name}` : "No longer under a milestone",
    { details: { milestoneId: target?.id ?? null, previousMilestoneId: task.milestone_id } });
  return row;
}

// ------------------------------------------------------------------ create
// input: { title, assigneeUserId, dueDate, description?, milestoneId?, priority?, taskType?, tags?, plannedStartDate?, estimateMinutes?, reviewRequired?,
// evidenceRequired?, reviewerUserId?, checklist?: [{ title, isRequired? } | string], prerequisiteIds?, template?: { ref, title?, description?, priority?,
// checklist?, estimateMinutes?, reviewRequired? }, idempotencyKey? }. The project comes from the route; the code from the company's numbering.
export async function createProjectTask(client, c, projectId, input = {}) {
  const key = keyOf(input);
  if (key) {
    const existing = (await client.query(`SELECT id, task_code, status FROM tenant.project_tasks WHERE organization_id = $1 AND create_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) return { taskId: existing.id, taskCode: existing.task_code, status: existing.status, replayed: true };
  }
  const { project, can } = await projectTaskScope(client, c, projectId);
  need(can, "create");
  projectOpen(project);
  return insertTask(client, c, project, input, key);
}
async function insertTask(client, c, project, raw, key) {
  if (raw.recurrence !== undefined || raw.recurring !== undefined || raw.repeat !== undefined) throw err(400, "TASK_RECURRENCE_UNSUPPORTED");
  // A template gives defaults; what the person typed wins. The task keeps only a reference to the template it came from.
  const template = raw.template && typeof raw.template === "object" ? raw.template : null;
  const input = { ...(template ? { title: template.title, description: template.description, priority: template.priority, checklist: template.checklist, estimateMinutes: template.estimateMinutes,
    reviewRequired: template.reviewRequired } : {}), ...Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined)) };
  const title = text(input.title, 300);
  if (title.length < 2 || title.length > 200) throw err(400, "TASK_TITLE_REQUIRED", undefined, { field: "title" });
  if (!input.assigneeUserId) throw err(400, "TASK_ASSIGNEE_INVALID", "Choose who the task is assigned to.", { field: "assigneeUserId" });
  const assignee = await projectContributor(client, c, project, input.assigneeUserId);
  if (!input.dueDate) throw err(400, "TASK_DUE_DATE_INVALID", "Choose the due date.", { field: "dueDate" });
  const due = dateOf(input.dueDate);
  const plannedStart = input.plannedStartDate ? dateOf(input.plannedStartDate, "plannedStartDate") : null;
  if (plannedStart && plannedStart > due) throw err(400, "TASK_DUE_DATE_INVALID", "The start date cannot be after the due date.", { field: "plannedStartDate" });
  const settings = (await client.query(`SELECT task_review_default FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0];
  const reviewRequired = input.reviewRequired === undefined ? Boolean(settings?.task_review_default) : Boolean(input.reviewRequired);
  const reviewer = input.reviewerUserId ? await projectContributor(client, c, project, input.reviewerUserId, { label: "Reviewer", code: "TASK_REVIEWER_INVALID" }) : null;
  const priority = validatePriority(input.priority);
  const type = enumOf(input.taskType, Object.keys(TASK_TYPES), "GENERAL", "Choose a task type.", "taskType");
  const checklist = (Array.isArray(input.checklist) ? input.checklist : []).map((item) => (typeof item === "string" ? { title: item } : item)).map((item) => ({
    title: text(item.title, 300), isRequired: item.isRequired !== false })).filter((item) => item.title);
  if (checklist.length > 100) throw err(400, "TASK_INPUT_INVALID", "Use at most 100 checklist items.", { field: "checklist" });
  const milestone = input.milestoneId ? await milestoneFor(client, c, project, input.milestoneId) : null;
  const code = await nextDocumentNumber(client, { organizationId: c.organizationId }, { documentType: "project_task" });
  const row = (await client.query(
    `INSERT INTO tenant.project_tasks (organization_id, project_id, task_code, title, description, assignee_user_id, reporter_user_id, reviewer_user_id, approval_status, review_required,
       evidence_required, priority, task_type, tags, planned_start_date, original_due_date, due_date, estimate_minutes, template_ref, create_key, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,$17,$18,$19,$7,$7) RETURNING *`,
    [c.organizationId, project.id, code, title, text(input.description, 10000) || null, assignee, c.userId ?? null, reviewer, reviewRequired ? "NOT_SUBMITTED" : "NOT_REQUIRED", reviewRequired,
      Boolean(input.evidenceRequired), priority, type, tagsOf(input.tags), plannedStart, due, estimateOf(input.estimateMinutes), template ? text(template.ref, 200) || "template" : null, key])).rows[0];
  for (const [index, item] of checklist.entries()) {
    await client.query(`INSERT INTO tenant.project_task_checklist_items (organization_id, task_id, title, is_required, position, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [c.organizationId, row.id, item.title, item.isRequired, index + 1, c.userId ?? null]);
  }
  await taskEvent(client, c, row, "CREATED", `${code} created: ${title}, due ${due}`, { to: "TO_DO", details: { dueDate: due, assigneeUserId: assignee } });
  let task = row;
  if (milestone) task = await fileUnder(client, c, { ...row, milestone_id: null }, project, milestone.id);
  for (const prerequisiteId of Array.isArray(input.prerequisiteIds) ? input.prerequisiteIds : []) await insertDependency(client, c, task, prerequisiteId);
  await notify(client, c, task, [assignee], { title: `New task: ${code}`, message: `${title} — due ${due} (${project.project_code}).` });
  return { taskId: task.id, taskCode: code, status: task.status };
}

// ------------------------------------------------------------------ edit and assign
// input: { title?, description?, priority?, taskType?, tags?, plannedStartDate?, dueDate?, dueDateReason?, estimateMinutes?, reviewRequired?, evidenceRequired?,
// reviewerUserId?, milestoneId?, withdrawReview?, expectedVersion?, idempotencyKey? }
export async function updateProjectTask(client, c, taskId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { task, project, can } = await taskScope(client, c, taskId, { lock: true });
  need(can, "edit");
  versionCheck(task, input.expectedVersion);
  projectOpen(project);
  const priorityChange = priorityChangeFor(task, input, "DONE");
  taskOpen(task);
  const given = (name) => input[name] !== undefined;
  const sets = priorityChange ? { priority: priorityChange.to } : {};
  const changes = [];
  const material = [];
  if (given("title")) {
    const title = text(input.title, 300);
    if (title.length < 2 || title.length > 200) throw err(400, "TASK_TITLE_REQUIRED", undefined, { field: "title" });
    if (title !== task.title) { sets.title = title; material.push("title"); }
  }
  if (given("description")) { const value = text(input.description, 10000) || null; if (value !== task.description) { sets.description = value; material.push("description"); } }
  if (given("taskType")) { const value = enumOf(input.taskType, Object.keys(TASK_TYPES), task.task_type, "Choose a task type.", "taskType"); if (value !== task.task_type) { sets.task_type = value; changes.push("type"); } }
  if (given("tags")) { const value = tagsOf(input.tags); if (value.join(",") !== (task.tags ?? []).join(",")) { sets.tags = value; changes.push("tags"); } }
  if (given("estimateMinutes")) { const value = estimateOf(input.estimateMinutes); if (value !== task.estimate_minutes) { sets.estimate_minutes = value; changes.push("estimate"); } }
  const plannedStart = given("plannedStartDate") ? (input.plannedStartDate ? dateOf(input.plannedStartDate, "plannedStartDate") : null) : day(task.planned_start_date);
  const due = given("dueDate") && input.dueDate ? dateOf(input.dueDate) : day(task.due_date);
  if (plannedStart && plannedStart > due) throw err(400, "TASK_DUE_DATE_INVALID", "The start date cannot be after the due date.", { field: "plannedStartDate" });
  if (given("plannedStartDate") && plannedStart !== day(task.planned_start_date)) { sets.planned_start_date = plannedStart; changes.push("start date"); }
  let dueChange = null;
  if (due !== day(task.due_date)) { dueChange = { from: day(task.due_date), to: due, reason: text(input.dueDateReason, 1000) || null }; sets.due_date = due; }
  if (given("reviewRequired") && Boolean(input.reviewRequired) !== task.review_required) {
    sets.review_required = Boolean(input.reviewRequired); material.push("review requirement");
  }
  if (given("evidenceRequired") && Boolean(input.evidenceRequired) !== task.evidence_required) { sets.evidence_required = Boolean(input.evidenceRequired); material.push("evidence requirement"); }
  if (given("reviewerUserId")) {
    const value = input.reviewerUserId ? await projectContributor(client, c, project, input.reviewerUserId, { label: "Reviewer", code: "TASK_REVIEWER_INVALID" }) : null;
    if (value !== task.reviewer_user_id) { sets.reviewer_user_id = value; changes.push("reviewer"); }
  }
  let row = task;
  if (given("milestoneId") && (input.milestoneId || null) !== (task.milestone_id ?? null)) {
    if (task.status === "IN_REVIEW" && !input.withdrawReview) throw err(409, "TASK_IN_REVIEW");
    row = await fileUnder(client, c, row, project, input.milestoneId || null);
  }
  if (!changes.length && !material.length && !dueChange && !priorityChange) return { taskId: row.id, version: row.row_version, changed: row === task ? [] : ["milestone"] };
  if (material.length) row = await changeScope(client, c, row, input, material.join(", "));
  if (material.length && row.status !== "IN_REVIEW") {
    const review = sets.review_required ?? row.review_required;
    if (!["PENDING"].includes(row.approval_status)) sets.approval_status = review ? "NOT_SUBMITTED" : "NOT_REQUIRED";
  }
  row = await write(client, c, row, sets);
  if (dueChange) {
    await taskEvent(client, c, row, "DUE_DATE_CHANGED", `Due ${dueChange.from} → ${dueChange.to}${dueChange.reason ? `: ${dueChange.reason}` : ""}`, { details: dueChange });
    await notify(client, c, row, [row.assignee_user_id], { title: `${row.task_code} is now due ${dueChange.to}`, message: `${row.title}${dueChange.reason ? `: ${dueChange.reason}` : ""}` });
  }
  // The priority is recorded on its own (with its reason); the request's key goes to it when nothing else changed.
  if (priorityChange) await recordTaskPriorityChange(client, c, { task, row, project, change: priorityChange, key: changes.length || material.length ? null : keyOf(input), notify: input.notify !== false });
  if (changes.length || material.length) await taskEvent(client, c, row, "UPDATED", `Changed: ${[...changes, ...material].join(", ")}`, { details: { fields: [...changes, ...material] }, key: keyOf(input) });
  return { taskId: row.id, version: row.row_version, changed: [...(priorityChange ? ["priority"] : []), ...changes, ...material, ...(dueChange ? ["due date"] : [])], status: row.status, priority: row.priority };
}

// ------------------------------------------------------------------ the lifecycle (one authority)
// input: { to: IN_PROGRESS | DONE | IN_REVIEW | BLOCKED | CANCELLED | TO_DO, ...the fields that move needs }. The task page, the board and bulk changes
// call this; each move re-checks permission, the project's state and every requirement.
export async function transitionProjectTask(client, c, taskId, input = {}) {
  const to = String(input.to ?? "").toUpperCase();
  const { task } = await taskScope(client, c, taskId);
  if (to === "IN_PROGRESS") {
    if (task.status === "IN_REVIEW") return withdrawTaskReview(client, c, taskId, input);
    if (task.status === "BLOCKED") throw err(409, "TASK_BLOCKER_ACTIVE");
    if (task.status === "DONE") return reopenProjectTask(client, c, taskId, input);
    return startProjectTask(client, c, taskId, input);
  }
  if (to === "DONE") {
    if (task.review_required) throw err(409, task.status === "IN_REVIEW" ? "TASK_STATUS_INVALID" : "TASK_REVIEW_REQUIRED",
      task.status === "IN_REVIEW" ? "This task is completed by its review decision." : undefined);
    return completeProjectTask(client, c, taskId, input);
  }
  if (to === "IN_REVIEW") return submitTaskForReview(client, c, taskId, input);
  if (to === "BLOCKED") return blockProjectTask(client, c, taskId, input);
  if (to === "CANCELLED") return cancelProjectTask(client, c, taskId, input);
  if (to === "TO_DO" && task.status === "TO_DO") return { taskId: task.id, status: "TO_DO", replayed: true };
  throw err(409, "TASK_STATUS_INVALID", `A ${TASK_STATUS_LABEL[task.status]?.toLowerCase() ?? ""} task cannot move to ${TASK_STATUS_LABEL[to]?.toLowerCase() ?? to.toLowerCase()}.`);
}

// To do -> In progress. Open earlier tasks stop it unless a lead gives an exception. input: { exceptionReason?, expectedVersion?, idempotencyKey? }
export async function startProjectTask(client, c, taskId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { task, project, can } = await taskScope(client, c, taskId, { lock: true });
  need(can, "start");
  versionCheck(task, input.expectedVersion);
  if (task.status === "IN_PROGRESS") return { taskId: task.id, status: task.status, replayed: true };
  projectWorking(project);
  if (task.status !== "TO_DO") throw err(409, task.status === "BLOCKED" ? "TASK_BLOCKER_ACTIVE" : "TASK_STATUS_INVALID");
  const exceptions = {};
  if (input.exceptionReason) { need(can, "exception"); exceptions.dependencies = reasonOf(input.exceptionReason); }
  const readiness = await taskReadinessFor(client, c, task, project, { stage: "start", exceptions });
  const failing = readiness.checks.filter((row) => row.blocking);
  if (failing.length) throw readinessError(failing, readiness.checks);
  const row = await write(client, c, task, { status: "IN_PROGRESS", actual_started_at: task.actual_started_at ?? new Date() });
  await taskEvent(client, c, row, "STARTED", exceptions.dependencies ? `Started before its earlier tasks by exception: ${exceptions.dependencies}` : "Work started",
    { from: "TO_DO", to: "IN_PROGRESS", key: keyOf(input), details: exceptions.dependencies ? { exception: exceptions.dependencies } : {} });
  return { taskId: row.id, status: row.status };
}

// Blocked, with the reason, what is wrong and who resolves it; the task resumes where it was once the last blocker is resolved. Blocking a task
// never puts the project on Hold. input: { reason (code), description, ownerUserId?, idempotencyKey? }
export async function blockProjectTask(client, c, taskId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { task, project, can } = await taskScope(client, c, taskId, { lock: true });
  need(can, "block");
  projectOpen(project);
  taskOpen(task);
  if (task.status === "IN_REVIEW") throw err(409, "TASK_IN_REVIEW");
  const description = text(input.description, 1000);
  if (description.length < 3) throw err(400, "TASK_REASON_REQUIRED", "Describe what is blocking the task.", { field: "description" });
  const reason = enumOf(input.reason ?? input.reasonCode, Object.keys(BLOCKER_REASONS), "OTHER", "Choose why the task is blocked.", "reason");
  const owner = input.ownerUserId ? await projectContributor(client, c, project, input.ownerUserId, { label: "Blocker owner" }) : task.assignee_user_id;
  const blocker = (await client.query(`INSERT INTO tenant.project_task_blockers (organization_id, task_id, reason_code, description, owner_user_id, raised_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [c.organizationId, task.id, reason, description, owner, c.userId ?? null])).rows[0];
  const row = ["TO_DO", "IN_PROGRESS"].includes(task.status) ? await write(client, c, task, { status: "BLOCKED", previous_status: task.status }) : await write(client, c, task, {});
  await taskEvent(client, c, row, "BLOCKED", `${BLOCKER_REASONS[reason]}: ${description}`, { from: task.status, to: row.status, key: keyOf(input), details: { blockerId: blocker.id, result: { blockerId: blocker.id } } });
  await notify(client, c, row, [row.assignee_user_id, owner, project.manager_user_id], { title: `${row.task_code} is blocked`, message: `${row.title}: ${description}` });
  return { taskId: row.id, status: row.status, blockerId: blocker.id };
}
// input: { blockerId, resolution, idempotencyKey? }
export async function resolveTaskBlocker(client, c, taskId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { task, project, can } = await taskScope(client, c, taskId, { lock: true });
  need(can, "block");
  projectOpen(project);
  const blocker = (await client.query(`SELECT * FROM tenant.project_task_blockers WHERE organization_id = $1 AND task_id = $2 AND id = $3`, [c.organizationId, task.id, uuid(input.blockerId, "Blocker")])).rows[0];
  if (!blocker) throw err(404, "TASK_NOT_FOUND", "Blocker not found.");
  if (blocker.status === "RESOLVED") return { taskId: task.id, status: task.status, replayed: true };
  const resolution = reasonOf(input.resolution, "Say how the blocker was resolved.");
  await client.query(`UPDATE tenant.project_task_blockers SET status = 'RESOLVED', resolution = $3, resolved_by = $4, resolved_at = clock_timestamp() WHERE organization_id = $1 AND id = $2`,
    [c.organizationId, blocker.id, resolution, c.userId ?? null]);
  const active = Number((await client.query(`SELECT count(*) AS n FROM tenant.project_task_blockers WHERE organization_id = $1 AND task_id = $2 AND status = 'ACTIVE'`, [c.organizationId, task.id])).rows[0].n);
  const row = task.status === "BLOCKED" && !active ? await write(client, c, task, { status: task.previous_status, previous_status: null }) : await write(client, c, task, {});
  await taskEvent(client, c, row, "UNBLOCKED", `Blocker resolved: ${resolution}`, { from: task.status, to: row.status, key: keyOf(input), details: { blockerId: blocker.id } });
  if (row.status !== task.status) await notify(client, c, row, [row.assignee_user_id], { title: `${row.task_code} is unblocked`, message: resolution });
  return { taskId: row.id, status: row.status };
}

// Evidence that the work is done (a note, a document reference — files are uploaded to the task). input: { note?, reference?, idempotencyKey? }
export async function recordTaskEvidence(client, c, taskId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { task, project, can } = await taskScope(client, c, taskId, { lock: true });
  if (!can.complete && !can.submit && !can.edit) throw err(403, "TASK_PERMISSION_DENIED");
  projectOpen(project);
  taskOpen(task);
  if (task.status === "IN_REVIEW") throw err(409, "TASK_IN_REVIEW");
  const row = await saveEvidence(client, c, task, input);
  return { taskId: row.id, version: row.row_version };
}
async function saveEvidence(client, c, task, input) {
  const note = input.note ?? input.evidenceNote ?? input.completionNote;
  const reference = input.reference ?? input.evidenceReference;
  const sets = {};
  if (note !== undefined && (text(note, 2000) || null) !== task.completion_note) sets.completion_note = text(note, 2000) || null;
  if (reference !== undefined && (text(reference, 300) || null) !== task.evidence_reference) sets.evidence_reference = text(reference, 300) || null;
  if (!Object.keys(sets).length) return task;
  const row = await write(client, c, task, sets);
  await taskEvent(client, c, row, "EVIDENCE_RECORDED", [sets.completion_note, sets.evidence_reference].filter(Boolean).join(" · ") || "Evidence cleared", { key: keyOf(input) });
  return row;
}

// The authoritative completion of a task that needs no review: the checklist, evidence, earlier tasks and blockers all hold, in a project in
// progress. input: { note?, reference?, exceptionReason?, expectedVersion?, idempotencyKey? }
export async function completeProjectTask(client, c, taskId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { task, project, can } = await taskScope(client, c, taskId, { lock: true });
  need(can, "complete");
  versionCheck(task, input.expectedVersion);
  if (task.status === "DONE") throw err(409, "TASK_ALREADY_COMPLETED");
  if (task.status === "CANCELLED") throw err(409, "TASK_STATUS_INVALID", "This task is cancelled.");
  projectWorking(project);
  if (task.review_required) throw err(409, "TASK_REVIEW_REQUIRED");
  if (task.status === "BLOCKED") throw err(409, "TASK_BLOCKER_ACTIVE");
  const exceptions = {};
  if (input.exceptionReason) { need(can, "exception"); exceptions.dependencies = reasonOf(input.exceptionReason); }
  const proven = await saveEvidence(client, c, task, input);
  return finishTask(client, c, proven, project, { from: task.status, exceptions, key: keyOf(input), action: "COMPLETED" });
}
// Done: completed_by is whoever did the work (the person completing it, or — through a review — the person who submitted it); the approver is
// on the review decision.
async function finishTask(client, c, task, project, { from, exceptions = {}, key, action, completedBy = c.userId ?? null }) {
  const readiness = await taskReadinessFor(client, c, task, project, { stage: "complete", exceptions });
  const failing = readiness.checks.filter((row) => row.blocking);
  if (failing.length) throw readinessError(failing, readiness.checks);
  const row = await write(client, c, task, { status: "DONE", completed_at: new Date(), completed_by: completedBy, actual_started_at: task.actual_started_at ?? new Date(), previous_status: null });
  await taskEvent(client, c, row, action, action === "APPROVED" ? "Approved in review: done" : `Done${exceptions.dependencies ? ` (earlier tasks by exception: ${exceptions.dependencies})` : ""}`,
    { from, to: "DONE", key });
  let milestoneOwner = null;
  if (row.milestone_id) milestoneOwner = (await client.query(`SELECT owner_user_id FROM tenant.project_milestones WHERE id = $1`, [row.milestone_id])).rows[0]?.owner_user_id ?? null;
  await notify(client, c, row, [project.manager_user_id, milestoneOwner, row.assignee_user_id, row.reporter_user_id], { title: `${row.task_code} is done`, message: row.title });
  return { taskId: row.id, status: "DONE" };
}

// ------------------------------------------------------------------ review
async function snapshotOf(client, c, task, readiness) {
  return {
    task: { code: task.task_code, title: task.title, description: task.description, dueDate: day(task.due_date), assigneeUserId: task.assignee_user_id, completionNote: task.completion_note,
      evidenceReference: task.evidence_reference, scopeVersion: task.scope_version },
    checklist: readiness.checklist.map((row) => ({ id: row.id, title: row.title, required: row.is_required, status: row.status, waiverReference: row.waiver_reference })),
    files: readiness.files.map((row) => ({ id: row.id, fileName: row.file_name, sha256: row.content_sha256 })),
    prerequisites: readiness.prerequisites.map((row) => ({ id: row.id, code: row.task_code, status: row.status })),
  };
}
// In progress -> In review, as an immutable snapshot of what is reviewed. input: { note?, reference?, exceptionReason?, expectedVersion?, idempotencyKey? }
export async function submitTaskForReview(client, c, taskId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { task, project, can } = await taskScope(client, c, taskId, { lock: true });
  need(can, "submit");
  versionCheck(task, input.expectedVersion);
  if (task.status === "IN_REVIEW") return { taskId: task.id, status: task.status, replayed: true };
  projectWorking(project);
  taskOpen(task);
  if (!task.review_required) throw err(409, "TASK_REVIEW_NOT_REQUIRED");
  if (task.status !== "IN_PROGRESS") throw err(409, task.status === "BLOCKED" ? "TASK_BLOCKER_ACTIVE" : "TASK_STATUS_INVALID", task.status === "TO_DO" ? "Start the task before submitting it." : undefined);
  const exceptions = {};
  if (input.exceptionReason) { need(can, "exception"); exceptions.dependencies = reasonOf(input.exceptionReason); }
  const proven = await saveEvidence(client, c, task, input);
  const readiness = await taskReadinessFor(client, c, proven, project, { stage: "submit", exceptions });
  const failing = readiness.checks.filter((row) => row.blocking);
  if (failing.length) throw readinessError(failing, readiness.checks);
  const number = Number((await client.query(`SELECT COALESCE(max(review_number), 0) + 1 AS n FROM tenant.project_task_reviews WHERE task_id = $1`, [task.id])).rows[0].n);
  const review = (await client.query(`INSERT INTO tenant.project_task_reviews (organization_id, task_id, review_number, scope_version, snapshot, note, submitted_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id`,
    [c.organizationId, task.id, number, proven.scope_version, JSON.stringify(await snapshotOf(client, c, proven, readiness)), text(input.note, 2000) || null, c.userId ?? null])).rows[0];
  const row = await write(client, c, proven, { status: "IN_REVIEW", approval_status: "PENDING", current_review_id: review.id });
  await taskEvent(client, c, row, "SUBMITTED", `Submitted for review (${number})${text(input.note, 200) ? `: ${text(input.note, 200)}` : ""}`,
    { from: "IN_PROGRESS", to: "IN_REVIEW", key: keyOf(input), details: { reviewId: review.id, result: { reviewId: review.id } } });
  await notify(client, c, row, [row.reviewer_user_id ?? project.manager_user_id], { title: `Review requested: ${row.task_code}`, message: row.title });
  return { taskId: row.id, status: row.status, reviewId: review.id, reviewNumber: number };
}
// In review -> In progress, the submission kept in the history. input: { reason?, idempotencyKey? }
export async function withdrawTaskReview(client, c, taskId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { task, project, can } = await taskScope(client, c, taskId, { lock: true });
  if (!can.submit && !can.edit) throw err(403, "TASK_PERMISSION_DENIED");
  projectOpen(project);
  if (task.status !== "IN_REVIEW") throw err(409, "TASK_STATUS_INVALID", "Only a task in review is withdrawn from it.");
  const row = await write(client, c, task, { status: "IN_PROGRESS", approval_status: "NOT_SUBMITTED", scope_version: task.scope_version + 1 });
  await taskEvent(client, c, row, "REVIEW_WITHDRAWN", `Withdrawn from review${text(input.reason, 500) ? `: ${text(input.reason, 500)}` : ""}`, { from: "IN_REVIEW", to: "IN_PROGRESS", key: keyOf(input) });
  return { taskId: row.id, status: row.status };
}
// The decision on the current submission. APPROVED completes the task through the same completion check (so a blocker or an earlier task
// reopened since still stops it); CHANGES_REQUESTED and REJECTED return it with the reason. Whoever submitted does not decide (unless allowed).
// input: { decision: APPROVED | CHANGES_REQUESTED | REJECTED, reason?, expectedVersion?, idempotencyKey? }
export async function decideTaskReview(client, c, taskId, input = {}) {
  const key = keyOf(input);
  if (key) {
    const existing = (await client.query(`SELECT task_id, decision FROM tenant.project_task_review_decisions WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (existing) return { taskId: existing.task_id, decision: existing.decision, replayed: true };
  }
  const { task, project, can } = await taskScope(client, c, taskId, { lock: true });
  const decision = enumOf(input.decision, ["APPROVED", "CHANGES_REQUESTED", "REJECTED"], null, "Approve, ask for changes or reject.", "decision");
  if (!decision) throw err(400, "TASK_INPUT_INVALID", "Approve, ask for changes or reject.", { field: "decision" });
  need(can, decision === "APPROVED" ? "approve" : "requestChanges");
  versionCheck(task, input.expectedVersion);
  if (decision === "APPROVED") projectWorking(project); else projectOpen(project);
  if (task.status !== "IN_REVIEW") throw err(409, "TASK_STATUS_INVALID", "Only a task in review is decided.");
  const review = (await client.query(`SELECT * FROM tenant.project_task_reviews WHERE id = $1`, [task.current_review_id])).rows[0];
  if (!review || review.scope_version !== task.scope_version) throw err(409, "TASK_REVIEW_STALE");
  const self = (await client.query(`SELECT task_self_review_allowed FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]?.task_self_review_allowed ?? false;
  if (!self && review.submitted_by && review.submitted_by === c.userId) throw err(403, "TASK_SELF_REVIEW");
  if ((await currentDecisionOf(client, c, task))) throw err(409, "TASK_ALREADY_DECIDED");
  const reason = decision === "APPROVED" ? text(input.reason, 2000) || null : reasonOf(input.reason, "Say what needs to change.");
  await client.query(`INSERT INTO tenant.project_task_review_decisions (organization_id, task_id, review_id, decision, reason, decided_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [c.organizationId, task.id, review.id, decision, reason, c.userId ?? null, key]);
  if (decision === "APPROVED") {
    const row = await write(client, c, task, { approval_status: "APPROVED" });
    const result = await finishTask(client, c, row, project, { from: "IN_REVIEW", key: null, action: "APPROVED", completedBy: review.submitted_by ?? c.userId ?? null });
    return { ...result, decision };
  }
  const row = await write(client, c, task, { status: "IN_PROGRESS", approval_status: decision });
  await taskEvent(client, c, row, decision === "REJECTED" ? "REJECTED" : "CHANGES_REQUESTED", `${decision === "REJECTED" ? "Rejected" : "Changes requested"} in review ${review.review_number}: ${reason}`,
    { from: "IN_REVIEW", to: "IN_PROGRESS", details: { reviewId: review.id, decision } });
  await notify(client, c, row, [row.assignee_user_id, review.submitted_by], { title: `${row.task_code}: changes requested`, message: reason });
  return { taskId: row.id, status: row.status, approvalStatus: decision, decision };
}
export const approveTaskReview = (client, c, taskId, input = {}) => decideTaskReview(client, c, taskId, { ...input, decision: "APPROVED" });
export const requestTaskChanges = (client, c, taskId, input = {}) => decideTaskReview(client, c, taskId, { ...input, decision: input.decision === "REJECTED" ? "REJECTED" : "CHANGES_REQUESTED" });

// ------------------------------------------------------------------ reopen, cancel, archive
// Done -> In progress, with a reason, by someone authorized. The original completion and reviews stay in the history; the milestone it supports
// is flagged for review when it is under review or complete (never reversed here). input: { reason, acknowledgeMilestone?, expectedVersion?, idempotencyKey? }
export async function reopenProjectTask(client, c, taskId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { task, project, can } = await taskScope(client, c, taskId, { lock: true });
  if (!can.reopen) throw err(403, can.view && task.status === "DONE" ? "TASK_REOPEN_APPROVAL_REQUIRED" : "TASK_PERMISSION_DENIED");
  versionCheck(task, input.expectedVersion);
  projectOpen(project);
  if (task.status !== "DONE") throw err(409, "TASK_STATUS_INVALID", "Only a done task is reopened.");
  const reason = reasonOf(input.reason, "Say why the task is reopened.");
  const milestone = task.milestone_id ? (await client.query(`SELECT id, milestone_code, status, owner_user_id FROM tenant.project_milestones WHERE id = $1`, [task.milestone_id])).rows[0] : null;
  const impacted = milestone && ["SUBMITTED", "COMPLETED"].includes(milestone.status);
  if (impacted && !input.acknowledgeMilestone) throw err(409, "TASK_MILESTONE_REVIEW", `${milestone.milestone_code} is ${milestone.status === "SUBMITTED" ? "under review" : "complete"}. Confirm you have reviewed the impact on it.`,
    { milestone: { id: milestone.id, code: milestone.milestone_code, status: milestone.status } });
  const row = await write(client, c, task, { status: "IN_PROGRESS", completed_at: null, completed_by: null, scope_version: task.scope_version + 1,
    approval_status: task.review_required ? "NOT_SUBMITTED" : "NOT_REQUIRED" });
  await taskEvent(client, c, row, "REOPENED", `Reopened (done ${task.completed_at ? isoDay(task.completed_at) : ""}): ${reason}`,
    { from: "DONE", to: "IN_PROGRESS", key: keyOf(input), details: { reason, previousCompletion: task.completed_at, milestoneReview: impacted ? milestone.id : null } });
  if (impacted) {
    await milestoneNote(client, c, milestone.id, "TASK_REOPENED", `${task.task_code} ${task.title} was reopened: ${reason}. Review whether the milestone's acceptance still holds.`);
    await notify(client, c, row, [milestone.owner_user_id], { title: `Review ${milestone.milestone_code}: a supporting task was reopened`, message: `${task.task_code} ${task.title}: ${reason}` });
  }
  await notify(client, c, row, [row.assignee_user_id], { title: `${row.task_code} was reopened`, message: reason });
  return { taskId: row.id, status: row.status, milestoneReview: impacted ? milestone.id : null };
}
// Any open task -> Cancelled, with a reason. Tasks that depend on it no longer wait for it (each reviewed first); time entries and expenses on it
// stay where they are; it never counts as complete. input: { reason, acknowledgeDependents?, expectedVersion?, idempotencyKey? }
export async function cancelProjectTask(client, c, taskId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { task, project, can } = await taskScope(client, c, taskId, { lock: true });
  need(can, "cancel");
  versionCheck(task, input.expectedVersion);
  if (task.status === "CANCELLED") return { taskId: task.id, status: task.status, replayed: true };
  if (task.status === "DONE") throw err(409, "TASK_ALREADY_COMPLETED", "A done task is reopened, not cancelled.");
  projectOpen(project);
  const reason = reasonOf(input.reason, "Say why the task is cancelled.");
  const dependents = (await taskDependentsOf(client, c, task.id)).filter((row) => row.status !== "CANCELLED");
  if (dependents.length && !input.acknowledgeDependents) throw err(409, "TASK_DEPENDENTS_EXIST", `${dependents.map((row) => row.task_code).join(", ")} depend on it.`,
    { dependents: dependents.map((row) => ({ id: row.id, code: row.task_code, status: row.status })) });
  for (const dependent of dependents) {
    await client.query(`UPDATE tenant.project_task_dependencies SET removed_at = clock_timestamp(), removed_by = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, dependent.dependency_id, c.userId ?? null]);
    await taskEvent(client, c, dependent, "DEPENDENCY_REMOVED", `No longer waits for ${task.task_code}: it was cancelled (${reason})`, { details: { prerequisiteId: task.id } });
  }
  await client.query(`UPDATE tenant.project_task_blockers SET status = 'RESOLVED', resolution = $3, resolved_by = $4, resolved_at = clock_timestamp() WHERE organization_id = $1 AND task_id = $2 AND status = 'ACTIVE'`,
    [c.organizationId, task.id, `Task cancelled: ${reason}`.slice(0, 1000), c.userId ?? null]);
  const row = await write(client, c, task, { status: "CANCELLED", cancelled_at: new Date(), cancelled_by: c.userId ?? null, cancel_reason: reason, previous_status: null });
  await taskEvent(client, c, row, "CANCELLED", reason, { from: task.status, to: "CANCELLED", key: keyOf(input), details: { dependents: dependents.map((r) => r.task_code) } });
  let milestoneOwner = null;
  if (row.milestone_id) {
    const milestone = await milestoneNote(client, c, row.milestone_id, "TASK_CANCELLED", `${row.task_code} ${row.title} was cancelled: ${reason}. Record what it means for the milestone.`);
    milestoneOwner = milestone?.owner_user_id ?? null;
  }
  await notify(client, c, row, [row.assignee_user_id, milestoneOwner, ...dependents.map((r) => r.assignee_user_id)], { title: `${row.task_code} was cancelled`, message: reason });
  return { taskId: row.id, status: "CANCELLED" };
}
// A done or cancelled task leaves the everyday lists (kept, and found under Archived). input: { restore? }
export async function archiveProjectTask(client, c, taskId, input = {}) {
  const { task, project, can } = await taskScope(client, c, taskId, { lock: true });
  need(can, "edit");
  projectOpen(project);
  if (input.restore) {
    if (!task.archived_at) return { taskId: task.id, archived: false, replayed: true };
    const row = await write(client, c, task, { archived_at: null, archived_by: null });
    await taskEvent(client, c, row, "RESTORED", "Restored from the archive");
    return { taskId: row.id, archived: false };
  }
  if (task.archived_at) return { taskId: task.id, archived: true, replayed: true };
  if (!["DONE", "CANCELLED"].includes(task.status)) throw err(409, "TASK_STATUS_INVALID", "Only a done or cancelled task is archived.");
  const row = await write(client, c, task, { archived_at: new Date(), archived_by: c.userId ?? null });
  await taskEvent(client, c, row, "ARCHIVED", "Archived");
  return { taskId: row.id, archived: true };
}

// ------------------------------------------------------------------ checklist
async function itemOf(client, c, task, itemId) {
  const row = (await client.query(`SELECT * FROM tenant.project_task_checklist_items WHERE organization_id = $1 AND task_id = $2 AND id = $3 AND removed_at IS NULL FOR UPDATE`,
    [c.organizationId, task.id, uuid(itemId, "Checklist item")])).rows[0];
  if (!row) throw err(404, "TASK_NOT_FOUND", "That checklist item is not on this task.");
  return row;
}
// One command for the checklist. input: { op: add | update | remove | reorder | done | undo | waive, itemId?, title?, isRequired?, note?, reference?, order?, withdrawReview?, idempotencyKey? }
// Adding, changing and removing steps is planning (the task's lead); ticking them off is the work (the assignee too, while the project is in progress).
export async function manageTaskChecklist(client, c, taskId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { task, project, can } = await taskScope(client, c, taskId, { lock: true });
  const op = String(input.op ?? "").toLowerCase();
  const key = keyOf(input);
  if (["add", "update", "remove", "reorder", "waive"].includes(op)) {
    need(can, "edit");
    projectOpen(project);
    if (op === "add") {
      const title = text(input.title, 300);
      if (!title) throw err(400, "TASK_INPUT_INVALID", "Name the checklist step.", { field: "title" });
      const row = await changeScope(client, c, task, input, "the checklist");
      const position = Number((await client.query(`SELECT COALESCE(max(position), 0) + 1 AS n FROM tenant.project_task_checklist_items WHERE task_id = $1 AND removed_at IS NULL`, [task.id])).rows[0].n);
      const item = (await client.query(`INSERT INTO tenant.project_task_checklist_items (organization_id, task_id, title, is_required, position, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [c.organizationId, task.id, title, input.isRequired !== false, position, c.userId ?? null])).rows[0];
      await taskEvent(client, c, row, "CHECKLIST_ADDED", `${title}${input.isRequired === false ? " (optional)" : ""}`, { key, details: { itemId: item.id, result: { itemId: item.id } } });
      return { taskId: task.id, itemId: item.id };
    }
    if (op === "reorder") {
      const live = await checklistOf(client, c, task.id);
      const order = (Array.isArray(input.order) ? input.order : []).map((id) => uuid(id, "Checklist item"));
      if (order.length !== live.length || new Set(order).size !== order.length || !order.every((id) => live.some((row) => row.id === id))) throw err(400, "TASK_INPUT_INVALID", "List every checklist step once.");
      taskOpen(task);
      for (const [index, id] of order.entries()) await client.query(`UPDATE tenant.project_task_checklist_items SET position = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, id, index + 1]);
      const row = await write(client, c, task, {});
      await taskEvent(client, c, row, "CHECKLIST_REORDERED", "Checklist reordered", { key });
      return { taskId: task.id, reordered: true };
    }
    const item = await itemOf(client, c, task, input.itemId);
    if (op === "update") {
      const title = input.title === undefined ? item.title : text(input.title, 300);
      if (!title) throw err(400, "TASK_INPUT_INVALID", "Name the checklist step.", { field: "title" });
      const required = input.isRequired === undefined ? item.is_required : Boolean(input.isRequired);
      if (title === item.title && required === item.is_required) return { taskId: task.id, itemId: item.id, changed: false };
      const row = await changeScope(client, c, task, input, "the checklist");
      await client.query(`UPDATE tenant.project_task_checklist_items SET title = $3, is_required = $4, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, item.id, title, required]);
      await taskEvent(client, c, row, "CHECKLIST_CHANGED", `${item.title} → ${title}${required ? "" : " (optional)"}`, { key, details: { itemId: item.id } });
      return { taskId: task.id, itemId: item.id, changed: true };
    }
    if (op === "remove") {
      const row = await changeScope(client, c, task, input, "the checklist");
      await client.query(`UPDATE tenant.project_task_checklist_items SET removed_at = clock_timestamp(), removed_by = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, item.id, c.userId ?? null]);
      await taskEvent(client, c, row, "CHECKLIST_REMOVED", item.title, { key, details: { itemId: item.id } });
      return { taskId: task.id, removed: true };
    }
    // waive: a required step set aside by a lead, with a reference (why, or what replaces it).
    taskOpen(task);
    if (task.status === "IN_REVIEW") throw err(409, "TASK_IN_REVIEW");
    if (item.status === "WAIVED") return { taskId: task.id, itemId: item.id, replayed: true };
    const reference = reasonOf(input.reference ?? input.reason, "Say why the step is waived.");
    await client.query(`UPDATE tenant.project_task_checklist_items SET status = 'WAIVED', waived_by = $3, waived_at = clock_timestamp(), waiver_reference = $4, completed_by = NULL, completed_at = NULL,
        row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, item.id, c.userId ?? null, reference]);
    const row = await write(client, c, task, {});
    await taskEvent(client, c, row, "CHECKLIST_WAIVED", `${item.title}: ${reference}`, { key, details: { itemId: item.id } });
    return { taskId: task.id, itemId: item.id, status: "WAIVED" };
  }
  if (!["done", "undo"].includes(op)) throw err(400, "TASK_INPUT_INVALID", "Unknown checklist change.");
  if (!can.start && !can.edit) throw err(403, "TASK_PERMISSION_DENIED");
  projectWorking(project);
  taskOpen(task);
  if (task.status === "IN_REVIEW") throw err(409, "TASK_IN_REVIEW");
  const item = await itemOf(client, c, task, input.itemId);
  if (op === "done") {
    if (item.status === "DONE") return { taskId: task.id, itemId: item.id, replayed: true };
    await client.query(`UPDATE tenant.project_task_checklist_items SET status = 'DONE', completed_by = $3, completed_at = clock_timestamp(), note = COALESCE($4, note), waived_by = NULL, waived_at = NULL,
        waiver_reference = NULL, row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, item.id, c.userId ?? null, text(input.note, 500) || null]);
    const row = await write(client, c, task, {});
    await taskEvent(client, c, row, "CHECKLIST_DONE", item.title, { key, details: { itemId: item.id } });
    return { taskId: task.id, itemId: item.id, status: "DONE" };
  }
  if (item.status === "PENDING") return { taskId: task.id, itemId: item.id, replayed: true };
  if (item.status === "WAIVED") need(can, "edit");
  await client.query(`UPDATE tenant.project_task_checklist_items SET status = 'PENDING', completed_by = NULL, completed_at = NULL, waived_by = NULL, waived_at = NULL, waiver_reference = NULL,
      row_version = row_version + 1 WHERE organization_id = $1 AND id = $2`, [c.organizationId, item.id]);
  const row = await write(client, c, task, {});
  await taskEvent(client, c, row, "CHECKLIST_UNDONE", item.title, { key, details: { itemId: item.id } });
  return { taskId: task.id, itemId: item.id, status: "PENDING" };
}

// ------------------------------------------------------------------ dependencies
async function insertDependency(client, c, task, prerequisiteId) {
  let id;
  try { id = uuid(prerequisiteId, "Earlier task"); } catch { throw err(400, "TASK_DEPENDENCY_INVALID"); }
  const prerequisite = (await client.query(`SELECT * FROM tenant.project_tasks WHERE organization_id = $1 AND id = $2`, [c.organizationId, id])).rows[0];
  if (!prerequisite || prerequisite.project_id !== task.project_id) throw err(400, "TASK_DEPENDENCY_INVALID", "An earlier task must belong to the same project.");
  if (prerequisite.id === task.id) throw err(400, "TASK_DEPENDENCY_INVALID", "A task cannot depend on itself.");
  if (prerequisite.status === "CANCELLED") throw err(400, "TASK_DEPENDENCY_INVALID", "A cancelled task cannot be an earlier task.");
  const exists = (await client.query(`SELECT 1 FROM tenant.project_task_dependencies WHERE task_id = $1 AND prerequisite_task_id = $2 AND removed_at IS NULL`, [task.id, prerequisite.id])).rows[0];
  if (exists) throw err(409, "TASK_DEPENDENCY_INVALID", `${task.task_code} already depends on ${prerequisite.task_code}.`);
  if (["DONE", "IN_REVIEW"].includes(task.status) && prerequisite.status !== "DONE")
    throw err(409, "TASK_DEPENDENCY_INVALID", `${task.task_code} is ${TASK_STATUS_LABEL[task.status].toLowerCase()}; it cannot wait for ${prerequisite.task_code}.`);
  const edges = (await client.query(`SELECT dependency.task_id, dependency.prerequisite_task_id FROM tenant.project_task_dependencies dependency JOIN tenant.project_tasks task ON task.id = dependency.task_id
     WHERE dependency.organization_id = $1 AND task.project_id = $2 AND dependency.removed_at IS NULL`, [c.organizationId, task.project_id])).rows.map((row) => [row.task_id, row.prerequisite_task_id]);
  if (createsTaskCycle(edges, task.id, prerequisite.id)) throw err(409, "TASK_DEPENDENCY_CYCLE", `${prerequisite.task_code} already depends (directly or not) on ${task.task_code}.`);
  const row = (await client.query(`INSERT INTO tenant.project_task_dependencies (organization_id, task_id, prerequisite_task_id, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
    [c.organizationId, task.id, prerequisite.id, c.userId ?? null])).rows[0];
  await taskEvent(client, c, task, "DEPENDENCY_ADDED", `Waits for ${prerequisite.task_code} ${prerequisite.title}`, { details: { prerequisiteId: prerequisite.id } });
  return row.id;
}
// input: { prerequisiteId, idempotencyKey? } | { dependencyId, remove: true }
export async function manageTaskDependency(client, c, taskId, input = {}) {
  const done = await replay(client, c, keyOf(input));
  if (done) return done;
  const { task, project, can } = await taskScope(client, c, taskId, { lock: true });
  need(can, "edit");
  projectOpen(project);
  if (input.remove) {
    const row = (await client.query(`SELECT dependency.*, prerequisite.task_code FROM tenant.project_task_dependencies dependency JOIN tenant.project_tasks prerequisite ON prerequisite.id = dependency.prerequisite_task_id
       WHERE dependency.organization_id = $1 AND dependency.task_id = $2 AND dependency.id = $3`, [c.organizationId, task.id, uuid(input.dependencyId, "Dependency")])).rows[0];
    if (!row) throw err(404, "TASK_NOT_FOUND", "That dependency is not on this task.");
    if (row.removed_at) return { taskId: task.id, removed: true, replayed: true };
    await client.query(`UPDATE tenant.project_task_dependencies SET removed_at = clock_timestamp(), removed_by = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.id, c.userId ?? null]);
    await write(client, c, task, {});
    await taskEvent(client, c, task, "DEPENDENCY_REMOVED", `No longer waits for ${row.task_code}`, { key: keyOf(input), details: { prerequisiteId: row.prerequisite_task_id } });
    return { taskId: task.id, removed: true };
  }
  if (task.status === "CANCELLED") throw err(409, "TASK_STATUS_INVALID", "This task is cancelled.");
  const dependencyId = await insertDependency(client, c, task, input.prerequisiteId);
  await write(client, c, task, {});
  if (keyOf(input)) await taskEvent(client, c, task, "DEPENDENCY_CONFIRMED", null, { key: keyOf(input), details: { result: { dependencyId } } });
  return { taskId: task.id, dependencyId };
}

// ------------------------------------------------------------------ files (the discussion is Comments and Collaboration)
export async function listTaskFiles(client, c, taskId) {
  const { task } = await taskScope(client, c, taskId);
  const rows = await listFiles(client, { organizationId: c.organizationId, entityType: TASK_ENTITY, entityId: task.id });
  const names = await userNames(client, rows.map((row) => row.uploadedBy));
  return rows.map((row) => ({ id: row.id, fileName: row.fileName, mimeType: row.mimeType, sizeBytes: Number(row.sizeBytes ?? 0), uploadedAt: row.createdAt, uploadedBy: names.get(row.uploadedBy) ?? null }));
}
export async function uploadTaskFile(client, c, taskId, input = {}, options = {}) {
  const { task, project, can } = await taskScope(client, c, taskId);
  need(can, "comment");
  projectOpen(project);
  if (task.status === "DONE") throw err(409, "TASK_ALREADY_COMPLETED", "A done task's files are kept as they were; reopen it to add more.");
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: TASK_ENTITY, entityId: task.id, prepared: input.prepared, uploadedBy: c.userId ?? null }, options);
  await taskEvent(client, c, task, "FILE_ADDED", file.fileName ?? file.file_name, { details: { fileId: file.id } });
  return { id: file.id, fileName: file.fileName ?? file.file_name };
}
// A file reviewed in a submission, or on a done task, stays with the record it proves.
export async function removeTaskFile(client, c, taskId, fileId) {
  const { task, can } = await taskScope(client, c, taskId);
  const row = (await taskFilesOf(client, c, task.id)).find((file) => file.id === uuid(fileId, "File"));
  if (!row) return { removed: true, replayed: true };
  if (row.uploaded_by !== c.userId && !can.edit) throw err(403, "TASK_PERMISSION_DENIED");
  if (task.status === "DONE" || task.status === "IN_REVIEW") throw err(409, task.status === "DONE" ? "TASK_ALREADY_COMPLETED" : "TASK_IN_REVIEW", "This file is part of the reviewed or completed work; it stays.");
  const reviewed = (await client.query(`SELECT 1 FROM tenant.project_task_reviews WHERE task_id = $1 AND snapshot -> 'files' @> $2::jsonb LIMIT 1`, [task.id, JSON.stringify([{ id: row.id }])])).rows[0];
  if (reviewed) throw err(409, "TASK_INPUT_INVALID", "This file was part of a review submission; it stays with the record.");
  await archiveFile(client, { organizationId: c.organizationId, entityType: TASK_ENTITY, entityId: task.id, fileId: row.id, actorUserId: c.userId ?? null });
  await taskEvent(client, c, task, "FILE_REMOVED", row.file_name, { details: { fileId: row.id } });
  return { removed: true };
}
export async function readTaskFile(client, c, taskId, fileId, options = {}) {
  const { task } = await taskScope(client, c, taskId);
  const row = (await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND id = $4`,
    [c.organizationId, TASK_ENTITY, String(task.id), uuid(fileId, "File")])).rows[0];
  if (!row) throw err(404, "TASK_NOT_FOUND", "File not found.");
  const content = await readFileContent(client, { organizationId: c.organizationId, entityType: TASK_ENTITY, entityId: task.id, fileId: row.id }, options);
  return { fileName: row.file_name, mimeType: row.mime_type, body: content.body };
}

// ------------------------------------------------------------------ saved views
// input: { name, filters, isDefault?, id? } — one's own; at most one default.
export async function saveTaskView(client, c, input = {}) {
  const name = text(input.name, 80);
  if (!name) throw err(400, "TASK_INPUT_INVALID", "Name the view.", { field: "name" });
  const filters = Object.fromEntries(Object.entries(input.filters ?? {}).filter(([, value]) => typeof value === "string" && value.length <= 200).slice(0, 20));
  if (input.isDefault) await client.query(`UPDATE tenant.project_task_views SET is_default = false WHERE organization_id = $1 AND user_id = $2`, [c.organizationId, c.userId]);
  const row = input.id
    ? (await client.query(`UPDATE tenant.project_task_views SET name = $4, filters = $5::jsonb, is_default = $6 WHERE organization_id = $1 AND user_id = $2 AND id = $3 RETURNING id`,
      [c.organizationId, c.userId, uuid(input.id, "View"), name, JSON.stringify(filters), Boolean(input.isDefault)])).rows[0]
    : (await client.query(`INSERT INTO tenant.project_task_views (organization_id, user_id, name, filters, is_default) VALUES ($1,$2,$3,$4::jsonb,$5)
        ON CONFLICT (organization_id, user_id, lower(name)) DO UPDATE SET filters = EXCLUDED.filters, is_default = EXCLUDED.is_default RETURNING id`,
      [c.organizationId, c.userId, name, JSON.stringify(filters), Boolean(input.isDefault)])).rows[0];
  if (!row) throw err(404, "TASK_NOT_FOUND", "View not found.");
  return { id: row.id };
}
export async function removeTaskView(client, c, viewId) {
  await client.query(`DELETE FROM tenant.project_task_views WHERE organization_id = $1 AND user_id = $2 AND id = $3`, [c.organizationId, c.userId, uuid(viewId, "View")]);
  return { removed: true };
}

// ------------------------------------------------------------------ bulk changes
// input: { taskIds, action: assign | priority | due_date | status | cancel, assigneeUserId?, priority?, dueDate?, reason?, to?, versions?: { [taskId]: version },
// idempotencyKey? }. Each task is changed on its own (its own savepoint, its own checks and history) through the same commands as one at a
// time; the answer says exactly which succeeded and which did not, and why. Repeating the command repeats nothing.
export async function bulkUpdateProjectTasks(client, c, input = {}) {
  const ids = [...new Set((Array.isArray(input.taskIds) ? input.taskIds : []).map((id) => uuid(id, "Task")))];
  if (!ids.length || ids.length > 200) throw err(400, "TASK_INPUT_INVALID", "Choose between 1 and 200 tasks.");
  const action = String(input.action ?? "").toLowerCase();
  if (!["assign", "priority", "due_date", "status", "cancel"].includes(action)) throw err(400, "TASK_INPUT_INVALID", "Choose what to change.");
  const key = keyOf(input);
  const results = [];
  for (const taskId of ids) {
    const each = key ? `${key}:${taskId}` : undefined;
    const expectedVersion = input.versions?.[taskId];
    await client.query("SAVEPOINT task_bulk");
    try {
      const { task, can } = await taskScope(client, c, taskId);
      if (!can.bulk) throw err(403, "TASK_PERMISSION_DENIED");
      let result;
      if (action === "assign") result = await assignProjectTask(client, c, taskId, { assigneeUserId: input.assigneeUserId, reasonCode: input.reasonCode, reasonText: input.reason, expectedVersion,
        idempotencyKey: each, notify: false });
      else if (action === "priority") result = await updateTaskPriority(client, c, taskId, { priority: input.priority, reason: input.reason, expectedVersion, idempotencyKey: each, notify: false });
      else if (action === "due_date") result = await updateProjectTask(client, c, taskId, { dueDate: input.dueDate, dueDateReason: input.reason, expectedVersion, idempotencyKey: each });
      else if (action === "cancel") result = await cancelProjectTask(client, c, taskId, { reason: input.reason, expectedVersion, idempotencyKey: each, acknowledgeDependents: Boolean(input.acknowledgeDependents) });
      else result = await transitionProjectTask(client, c, taskId, { to: input.to, reason: input.reason, expectedVersion, idempotencyKey: each });
      await client.query("RELEASE SAVEPOINT task_bulk");
      results.push({ taskId, code: task.task_code, ok: true, status: result.status ?? null, replayed: Boolean(result.replayed), ...(action === "priority" ? { changed: result.changed !== false } : {}) });
    } catch (failure) {
      await client.query("ROLLBACK TO SAVEPOINT task_bulk");
      if (!failure?.code || !String(failure.code).match(/^(TASK_|PROJECT_|ASSIGNEE_|PRIORITY_)/)) throw failure;
      const code = (await client.query(`SELECT task_code FROM tenant.project_tasks WHERE organization_id = $1 AND id = $2`, [c.organizationId, taskId])).rows[0]?.task_code ?? null;
      results.push({ taskId, code, ok: false, error: { code: failure.code, message: failure.message } });
    }
  }
  const succeeded = results.filter((row) => row.ok).length;
  if (action === "assign") await announceBulkAssignment(client, c, input.assigneeUserId, results);
  if (action === "priority") await announceBulkPriority(client, c, input.priority, input.reason, results);
  return { results, succeeded, failed: results.length - succeeded, summary: succeeded === results.length ? `All ${succeeded} task(s) updated.` : `${succeeded} of ${results.length} task(s) updated; ${results.length - succeeded} could not be.`,
    ...(action === "priority" && succeeded < results.length ? { code: "PRIORITY_BULK_PARTIAL_FAILURE" } : {}) };
}

// For the Assignees and Priority features, which change tasks through the same history, notifications and versioning as every task command.
export { closed as isProjectClosed, notify as notifyTask, replay as replayTaskCommand, write as writeTask };
