// Projects — Tasks, read: one task with its checklist, dependencies, blockers, reviews, comments, files, linked records and readiness; a
// project's tasks; the cross-project work queue (list and board); saved views; reports and export; progress rebuilt from the status history;
// due-soon and overdue reminders; and the sources that feed project progress and the milestones' task links. Everything is read from the
// tasks' own records on each request.
import { createNotification } from "../../core/platform/notifications/index.js";
import { PROJECT, has, isoDay, projectError, text, userNames, uuid, visibleProject, visibilitySql } from "./project-core.js";
import { orgDay } from "./project-milestone-read.js";
import { MILESTONE_STATUS_LABEL, registerMilestoneTaskSource } from "./project-milestone-rules.js";
import { registerProjectWorkSource } from "./project-summary.js";
import {
  BLOCKER_REASONS, OPEN_TASK_STATUSES, TASK_APPROVAL_LABEL, TASK_ENTITY, TASK_STATUS_LABEL, TASK_TYPES, taskAccess, taskReadiness, taskRecordSources,
} from "./project-task-rules.js";

const err = (status, code, message, details) => projectError(status, code, message, details);
const day = (value) => (value ? isoDay(value) : null);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
const reminderDays = async (client, c) => Number((await client.query(`SELECT task_reminder_days FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]?.task_reminder_days ?? 1);

// ------------------------------------------------------------------ loading
// The task, its project and what the person may do on it. Someone who may not see it learns nothing about it.
export async function taskScope(client, c, taskId, { lock = false } = {}) {
  const row = (await client.query(`SELECT * FROM tenant.project_tasks WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`, [c.organizationId, uuid(taskId, "Task")])).rows[0];
  if (!row) throw err(404, "TASK_NOT_FOUND");
  let scope;
  try { scope = await visibleProject(client, c, row.project_id); } catch (failure) {
    if (failure?.status === 404) throw err(404, "TASK_NOT_FOUND");
    if (failure?.status === 403) throw err(403, "TASK_PERMISSION_DENIED");
    throw failure;
  }
  const can = taskAccess(c, scope.access, row);
  if (!can.view) throw err(has(c, PROJECT.taskView) ? 404 : 403, has(c, PROJECT.taskView) ? "TASK_NOT_FOUND" : "TASK_PERMISSION_DENIED");
  return { task: row, project: scope.project, access: scope.access, can };
}
export async function projectTaskScope(client, c, projectId) {
  let scope;
  try { scope = await visibleProject(client, c, projectId); } catch (failure) {
    if (failure?.status === 404) throw err(404, "TASK_PROJECT_INVALID");
    throw failure;
  }
  const can = taskAccess(c, scope.access);
  if (!can.view) throw err(403, "TASK_PERMISSION_DENIED");
  return { project: scope.project, access: scope.access, can };
}

export const checklistOf = async (client, c, taskId) => (await client.query(
  `SELECT * FROM tenant.project_task_checklist_items WHERE organization_id = $1 AND task_id = $2 AND removed_at IS NULL ORDER BY position, created_at`, [c.organizationId, taskId])).rows;
export const taskPrerequisitesOf = async (client, c, taskId) => (await client.query(
  `SELECT dependency.id AS dependency_id, prerequisite.* FROM tenant.project_task_dependencies dependency JOIN tenant.project_tasks prerequisite ON prerequisite.id = dependency.prerequisite_task_id
    WHERE dependency.organization_id = $1 AND dependency.task_id = $2 AND dependency.removed_at IS NULL ORDER BY prerequisite.due_date, prerequisite.task_code`, [c.organizationId, taskId])).rows;
export const taskDependentsOf = async (client, c, taskId) => (await client.query(
  `SELECT dependency.id AS dependency_id, dependent.* FROM tenant.project_task_dependencies dependency JOIN tenant.project_tasks dependent ON dependent.id = dependency.task_id
    WHERE dependency.organization_id = $1 AND dependency.prerequisite_task_id = $2 AND dependency.removed_at IS NULL ORDER BY dependent.due_date, dependent.task_code`, [c.organizationId, taskId])).rows;
export const taskBlockersOf = async (client, c, taskId) => (await client.query(
  `SELECT * FROM tenant.project_task_blockers WHERE organization_id = $1 AND task_id = $2 ORDER BY status, raised_at DESC`, [c.organizationId, taskId])).rows;
export const taskReviewsOf = async (client, c, taskId) => (await client.query(
  `SELECT review.*, decision.id AS decision_id, decision.decision, decision.reason, decision.decided_by, decision.decided_at FROM tenant.project_task_reviews review
     LEFT JOIN tenant.project_task_review_decisions decision ON decision.review_id = review.id
    WHERE review.organization_id = $1 AND review.task_id = $2 ORDER BY review.review_number DESC`, [c.organizationId, taskId])).rows;
export const taskFilesOf = async (client, c, taskId) => (await client.query(
  `SELECT id, file_name, content_sha256, uploaded_by, created_at FROM public.attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND is_current AND lifecycle_status <> 'archived'
    ORDER BY created_at DESC`, [c.organizationId, TASK_ENTITY, String(taskId)])).rows;
// The decision on the current submission, with the scope it was made on.
export async function currentDecisionOf(client, c, task) {
  if (!task.current_review_id) return null;
  return (await client.query(`SELECT decision.*, review.scope_version FROM tenant.project_task_review_decisions decision JOIN tenant.project_task_reviews review ON review.id = decision.review_id
     WHERE decision.organization_id = $1 AND decision.review_id = $2`, [c.organizationId, task.current_review_id])).rows[0] ?? null;
}
export async function taskReadinessFor(client, c, task, project, { stage = "complete", exceptions = {} } = {}) {
  const [checklist, prerequisites, blockers, decision, files] = await Promise.all([checklistOf(client, c, task.id), taskPrerequisitesOf(client, c, task.id), taskBlockersOf(client, c, task.id),
    currentDecisionOf(client, c, task), taskFilesOf(client, c, task.id)]);
  return { ...taskReadiness({ task, project, checklist, prerequisites, blockers, decision, files: files.length, stage, exceptions }), checklist, prerequisites, blockers, decision, files };
}

// ------------------------------------------------------------------ shaping
const dueState = (row, today) => {
  if (!OPEN_TASK_STATUSES.includes(row.status)) return { overdue: false, dueIn: null };
  const left = daysBetween(today, day(row.due_date));
  // Overdue once the due date has passed in the company's day — never on the morning of the due date.
  return { overdue: left < 0, dueIn: left };
};
function taskRow(row, names, today, extra = {}) {
  const due = dueState(row, today);
  return {
    id: row.id, code: row.task_code, title: row.title, projectId: row.project_id, milestoneId: row.milestone_id, assigneeId: row.assignee_user_id,
    assignee: names.get(row.assignee_user_id) ?? null, status: row.status, statusLabel: TASK_STATUS_LABEL[row.status], approvalStatus: row.approval_status,
    approvalLabel: TASK_APPROVAL_LABEL[row.approval_status], priority: row.priority, type: row.task_type, typeLabel: TASK_TYPES[row.task_type], tags: row.tags ?? [],
    plannedStartDate: day(row.planned_start_date), dueDate: day(row.due_date), originalDueDate: day(row.original_due_date), rescheduled: day(row.due_date) !== day(row.original_due_date),
    completedAt: row.completed_at, reviewRequired: row.review_required, estimateMinutes: row.estimate_minutes, archived: Boolean(row.archived_at), overdue: due.overdue, dueIn: due.dueIn,
    updatedAt: row.updated_at, version: row.row_version, ...extra,
  };
}

// ------------------------------------------------------------------ one task
export async function getTaskDetails(client, c, taskId) {
  const { task, project, access, can } = await taskScope(client, c, taskId);
  const readiness = await taskReadinessFor(client, c, task, project, { stage: task.review_required && task.status !== "IN_REVIEW" ? "submit" : "complete" });
  const [dependents, reviews] = await Promise.all([taskDependentsOf(client, c, task.id), taskReviewsOf(client, c, task.id)]);
  const today = await orgDay(client, c);
  const milestone = task.milestone_id ? (await client.query(`SELECT id, milestone_code, name, status, approval_status FROM tenant.project_milestones WHERE id = $1`, [task.milestone_id])).rows[0] ?? null : null;
  const names = await userNames(client, [task.assignee_user_id, task.reporter_user_id, task.reviewer_user_id, task.completed_by, task.cancelled_by, task.archived_by, project.manager_user_id,
    ...readiness.checklist.flatMap((row) => [row.completed_by, row.waived_by]), ...readiness.blockers.flatMap((row) => [row.owner_user_id, row.raised_by, row.resolved_by]),
    ...reviews.flatMap((row) => [row.submitted_by, row.decided_by]), ...readiness.files.map((row) => row.uploaded_by)]);
  // The customer, for context (through the project and only for those who may see it).
  const customer = project.classification === "CUSTOMER" && project.customer_id && has(c, PROJECT.customerView)
    ? (await client.query(`SELECT party.display_name AS name, contact.display_name AS contact FROM tenant.business_parties party
         LEFT JOIN tenant.contacts contact ON contact.id = $2 WHERE party.id = $1`, [project.customer_id, project.customer_contact_id])).rows[0] ?? null : null;
  const records = [];
  for (const source of taskRecordSources()) {
    const summary = (await source.summarize(client, c, [task.id])).get(task.id);
    records.push({ key: source.key, label: source.label, count: summary?.count ?? 0, summary: summary?.label ?? null });
  }
  const selfReview = (await client.query(`SELECT task_self_review_allowed FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0]?.task_self_review_allowed ?? false;
  const status = task.status;
  const open = OPEN_TASK_STATUSES.includes(status);
  const projectOpen = !["COMPLETED", "CANCELLED"].includes(project.status) && !project.archived_at && !project.deleted_at;
  const working = project.status === "IN_PROGRESS";
  const current = reviews.find((row) => row.id === task.current_review_id) ?? null;
  const decided = Boolean(current?.decision_id);
  const notMine = selfReview || current?.submitted_by !== c.userId;
  const unmet = readiness.prerequisites.filter((row) => row.status !== "DONE");
  return {
    ...taskRow(task, names, today),
    description: task.description, projectCode: project.project_code, projectName: project.name, projectStatus: project.status, projectManager: names.get(project.manager_user_id) ?? null,
    customer: customer ? { name: customer.name, contact: customer.contact ?? null } : null,
    milestone: milestone ? { id: milestone.id, code: milestone.milestone_code, name: milestone.name, status: milestone.status, statusLabel: MILESTONE_STATUS_LABEL[milestone.status] } : null,
    reporter: names.get(task.reporter_user_id) ?? null, reviewerId: task.reviewer_user_id, reviewer: names.get(task.reviewer_user_id) ?? null, evidenceRequired: task.evidence_required,
    completionNote: task.completion_note, evidenceReference: task.evidence_reference, actualStartedAt: task.actual_started_at, completedBy: names.get(task.completed_by) ?? null,
    cancelledAt: task.cancelled_at, cancelReason: task.cancel_reason, cancelledBy: names.get(task.cancelled_by) ?? null, archivedAt: task.archived_at,
    templateRef: task.template_ref, scopeVersion: task.scope_version, previousStatus: task.previous_status, createdAt: task.created_at,
    checklist: readiness.checklist.map((row) => ({ id: row.id, title: row.title, required: row.is_required, status: row.status, position: row.position, note: row.note,
      completedBy: names.get(row.completed_by) ?? null, completedAt: row.completed_at, waivedBy: names.get(row.waived_by) ?? null, waiverReference: row.waiver_reference, version: row.row_version })),
    checklistProgress: (() => { const live = readiness.checklist; const done = live.filter((row) => row.status !== "PENDING").length; return { total: live.length, done, percent: live.length ? Math.floor((done / live.length) * 100) : null }; })(),
    prerequisites: readiness.prerequisites.map((row) => ({ dependencyId: row.dependency_id, id: row.id, code: row.task_code, title: row.title, status: row.status, statusLabel: TASK_STATUS_LABEL[row.status], dueDate: day(row.due_date) })),
    dependents: dependents.map((row) => ({ dependencyId: row.dependency_id, id: row.id, code: row.task_code, title: row.title, status: row.status, statusLabel: TASK_STATUS_LABEL[row.status] })),
    blockers: readiness.blockers.map((row) => ({ id: row.id, reason: row.reason_code, reasonLabel: BLOCKER_REASONS[row.reason_code], description: row.description, ownerId: row.owner_user_id,
      owner: names.get(row.owner_user_id) ?? null, status: row.status, resolution: row.resolution, raisedBy: names.get(row.raised_by) ?? null, raisedAt: row.raised_at,
      resolvedBy: names.get(row.resolved_by) ?? null, resolvedAt: row.resolved_at })),
    reviews: reviews.map((row) => ({ id: row.id, number: row.review_number, note: row.note, submittedBy: names.get(row.submitted_by) ?? null, submittedAt: row.submitted_at,
      current: row.id === task.current_review_id, stale: row.scope_version !== task.scope_version, snapshot: row.snapshot,
      decision: row.decision_id ? { decision: row.decision, reason: row.reason, decidedBy: names.get(row.decided_by) ?? null, decidedAt: row.decided_at } : null })),
    files: readiness.files.map((row) => ({ id: row.id, fileName: row.file_name, uploadedBy: names.get(row.uploaded_by) ?? null, uploadedAt: row.created_at })),
    records,
    readiness: { ready: readiness.ready, checks: readiness.checks },
    can: {
      edit: can.edit && open && projectOpen, assign: can.assign && open && projectOpen, start: can.start && status === "TO_DO" && working, startByException: can.exception && status === "TO_DO" && working && unmet.length > 0,
      block: can.block && ["TO_DO", "IN_PROGRESS"].includes(status) && projectOpen, resolveBlocker: can.block && projectOpen, checklist: (can.start || can.edit) && ["TO_DO", "IN_PROGRESS", "BLOCKED"].includes(status) && working,
      manageChecklist: can.edit && open && status !== "IN_REVIEW" && projectOpen, waive: can.edit && open && status !== "IN_REVIEW" && projectOpen,
      complete: can.complete && !task.review_required && ["TO_DO", "IN_PROGRESS"].includes(status) && working,
      submit: can.submit && task.review_required && status === "IN_PROGRESS" && working, withdraw: (can.submit || can.edit) && status === "IN_REVIEW" && projectOpen,
      approve: can.approve && status === "IN_REVIEW" && !decided && notMine && working, requestChanges: can.requestChanges && status === "IN_REVIEW" && !decided && notMine && projectOpen,
      reopen: can.reopen && status === "DONE" && projectOpen, cancel: can.cancel && open && projectOpen, archive: can.edit && ["DONE", "CANCELLED"].includes(status) && !task.archived_at,
      restore: can.edit && Boolean(task.archived_at), comment: can.comment && projectOpen, evidence: (can.complete || can.submit || can.edit) && open && projectOpen,
      dependencies: can.edit && open && projectOpen,
    },
  };
}
export async function getTaskActivity(client, c, taskId) {
  const { task } = await taskScope(client, c, taskId);
  const rows = (await client.query(`SELECT * FROM tenant.project_task_events WHERE organization_id = $1 AND task_id = $2 ORDER BY occurred_at DESC LIMIT 300`, [c.organizationId, task.id])).rows;
  const names = await userNames(client, rows.map((row) => row.actor_user_id));
  return rows.map((row) => ({ id: row.id, action: row.action, summary: row.summary, from: row.from_status, to: row.to_status, actor: names.get(row.actor_user_id) ?? "System", at: row.occurred_at }));
}
export async function getTaskComments(client, c, taskId) {
  const { task } = await taskScope(client, c, taskId);
  const rows = (await client.query(`SELECT * FROM tenant.project_task_comments WHERE organization_id = $1 AND task_id = $2 AND removed_at IS NULL ORDER BY created_at`, [c.organizationId, task.id])).rows;
  const names = await userNames(client, rows.flatMap((row) => [row.author_user_id, ...(row.mentions ?? [])]));
  return rows.map((row) => ({ id: row.id, body: row.body, author: names.get(row.author_user_id) ?? null, mine: row.author_user_id === c.userId, createdAt: row.created_at,
    mentions: (row.mentions ?? []).map((id) => names.get(id) ?? "Someone") }));
}

// ------------------------------------------------------------------ the work queue (a project's tasks, My Tasks, All Tasks, the board)
const QUEUE_SORT = { due: "task.due_date", code: "task.task_code", title: "task.title", project: "project.project_code", status: "task.status", priority: "array_position(ARRAY['URGENT','HIGH','NORMAL','LOW'], task.priority)",
  assignee: "assignee.full_name", updated: "task.updated_at" };
export const PROJECT_TASK_VIEWS = Object.freeze(["all", "open", "mine", "due_soon", "overdue", "in_review", "my_reviews", "blocked", "completed", "cancelled", "archived"]);
// filters: { view, projectId, milestoneId, assigneeId, status (one or comma list), priority, type, tag, search, due: overdue | soon, sort, direction, page, pageSize }
export async function listTaskQueue(client, c, filters = {}) {
  if (!has(c, PROJECT.taskView) || !(has(c, PROJECT.view) || has(c, PROJECT.viewAll))) throw err(403, "TASK_PERMISSION_DENIED");
  const values = [c.organizationId, c.userId ?? null];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["task.organization_id = $1", "project.deleted_at IS NULL", visibilitySql(c, "project", "$2")];
  const today = await orgDay(client, c);
  const soon = Math.max(await reminderDays(client, c), 3);
  const open = `task.status IN ('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW')`;
  const view = PROJECT_TASK_VIEWS.includes(String(filters.view)) ? String(filters.view) : "all";
  if (view !== "archived") where.push("task.archived_at IS NULL");
  if (view === "all") where.push("task.status <> 'CANCELLED'");
  if (view === "open") where.push(open);
  if (view === "mine") where.push("task.assignee_user_id = $2", open);
  if (view === "due_soon") { const from = bind(today); where.push(open, `task.due_date BETWEEN ${from}::date AND ${from}::date + ${bind(soon)}::int`); }
  if (view === "overdue") where.push(open, `task.due_date < ${bind(today)}::date`);
  if (view === "in_review") where.push("task.status = 'IN_REVIEW'");
  if (view === "my_reviews") where.push("task.status = 'IN_REVIEW'", "(task.reviewer_user_id = $2 OR (task.reviewer_user_id IS NULL AND project.manager_user_id = $2))");
  if (view === "blocked") where.push("task.status = 'BLOCKED'");
  if (view === "completed") where.push("task.status = 'DONE'");
  if (view === "cancelled") where.push("task.status = 'CANCELLED'");
  if (view === "archived") where.push("task.archived_at IS NOT NULL");
  if (filters.projectId) where.push(`task.project_id = ${bind(uuid(filters.projectId, "Project"))}`);
  if (filters.milestoneId) where.push(filters.milestoneId === "none" ? "task.milestone_id IS NULL" : `task.milestone_id = ${bind(uuid(filters.milestoneId, "Milestone"))}`);
  if (filters.assigneeId) where.push(`task.assignee_user_id = ${bind(uuid(filters.assigneeId, "Assignee"))}`);
  if (filters.status) {
    const statuses = String(filters.status).toUpperCase().split(",").filter((value) => TASK_STATUS_LABEL[value]);
    if (statuses.length) where.push(`task.status = ANY(${bind(statuses)}::text[])`);
  }
  if (filters.priority && ["LOW", "NORMAL", "HIGH", "URGENT"].includes(String(filters.priority).toUpperCase())) where.push(`task.priority = ${bind(String(filters.priority).toUpperCase())}`);
  if (filters.type && TASK_TYPES[String(filters.type).toUpperCase()]) where.push(`task.task_type = ${bind(String(filters.type).toUpperCase())}`);
  if (filters.tag) where.push(`${bind(text(filters.tag, 40).toLowerCase())} = ANY(task.tags)`);
  if (filters.due === "overdue") where.push(open, `task.due_date < ${bind(today)}::date`);
  if (filters.due === "soon") { const from = bind(today); where.push(open, `task.due_date BETWEEN ${from}::date AND ${from}::date + ${bind(soon)}::int`); }
  if (filters.search) {
    const term = bind(`%${text(filters.search, 100).replace(/[%_]/g, "\\$&")}%`);
    where.push(`(task.title ILIKE ${term} OR task.task_code ILIKE ${term} OR project.project_code ILIKE ${term} OR project.name ILIKE ${term} OR array_to_string(task.tags, ' ') ILIKE ${term})`);
  }
  const sort = QUEUE_SORT[filters.sort] ?? QUEUE_SORT.due;
  const direction = String(filters.direction).toLowerCase() === "desc" ? "DESC" : "ASC";
  const pageSize = Math.min(Math.max(Number(filters.pageSize) || 25, 1), 500);
  const page = Math.max(Number(filters.page) || 1, 1);
  const from = `FROM tenant.project_tasks task JOIN tenant.projects project ON project.id = task.project_id AND project.organization_id = task.organization_id
    LEFT JOIN public.users assignee ON assignee.id = task.assignee_user_id
    LEFT JOIN tenant.project_milestones milestone ON milestone.id = task.milestone_id WHERE ${where.join(" AND ")}`;
  const total = Number((await client.query(`SELECT count(*) AS n ${from}`, values)).rows[0].n);
  const limit = bind(pageSize);
  const offset = bind((page - 1) * pageSize);
  const rows = (await client.query(`SELECT task.*, project.project_code, project.name AS project_name, project.status AS project_status, milestone.milestone_code, milestone.name AS milestone_name,
      (SELECT count(*) FROM tenant.project_task_checklist_items item WHERE item.task_id = task.id AND item.removed_at IS NULL)::int AS checklist_total,
      (SELECT count(*) FROM tenant.project_task_checklist_items item WHERE item.task_id = task.id AND item.removed_at IS NULL AND item.status <> 'PENDING')::int AS checklist_done
      ${from} ORDER BY ${sort} ${direction} NULLS LAST, task.task_code LIMIT ${limit} OFFSET ${offset}`, values)).rows;
  const names = await userNames(client, rows.map((row) => row.assignee_user_id));
  return {
    rows: rows.map((row) => taskRow(row, names, today, { projectCode: row.project_code, projectName: row.project_name, projectStatus: row.project_status,
      milestone: row.milestone_id ? { id: row.milestone_id, code: row.milestone_code, name: row.milestone_name } : null, checklist: { total: row.checklist_total, done: row.checklist_done } })),
    total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)),
    can: { export: has(c, PROJECT.taskExport), bulk: has(c, PROJECT.taskBulk) },
  };
}
// A project's tasks, with what the person may do there and the project's milestones to file them under.
export async function getProjectTasks(client, c, projectId, filters = {}) {
  const { project, can } = await projectTaskScope(client, c, projectId);
  const list = await listTaskQueue(client, c, { pageSize: 500, sort: "due", ...filters, projectId: project.id, view: filters.view ?? "all" });
  const milestones = (await client.query(`SELECT id, milestone_code, name, status FROM tenant.project_milestones WHERE organization_id = $1 AND project_id = $2 AND status <> 'CANCELLED' ORDER BY sequence`,
    [c.organizationId, project.id])).rows.map((row) => ({ id: row.id, code: row.milestone_code, name: row.name, status: row.status, linkable: ["NOT_STARTED", "IN_PROGRESS", "BLOCKED"].includes(row.status) }));
  const counts = (await client.query(`SELECT status, count(*)::int AS n FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = $2 AND archived_at IS NULL GROUP BY status`, [c.organizationId, project.id])).rows;
  const by = Object.fromEntries(counts.map((row) => [row.status, row.n]));
  const active = Object.entries(by).filter(([status]) => status !== "CANCELLED").reduce((sum, [, n]) => sum + n, 0);
  const settings = (await client.query(`SELECT task_review_default FROM tenant.project_settings WHERE organization_id = $1`, [c.organizationId])).rows[0];
  return {
    ...list, projectId: project.id, projectCode: project.project_code, projectStatus: project.status, targetEndDate: day(project.target_end_date), milestones,
    summary: { total: active, done: by.DONE ?? 0, open: active - (by.DONE ?? 0), blocked: by.BLOCKED ?? 0, inReview: by.IN_REVIEW ?? 0, overdue: list.rows.filter((row) => row.overdue).length,
      percent: active ? Math.floor(((by.DONE ?? 0) / active) * 100) : null },
    can: { ...list.can, create: can.create && !["COMPLETED", "CANCELLED"].includes(project.status) && !project.archived_at, bulk: can.bulk },
    reviewDefault: settings?.task_review_default ?? false,
  };
}
export async function listTaskViews(client, c) {
  return (await client.query(`SELECT id, name, filters, is_default FROM tenant.project_task_views WHERE organization_id = $1 AND user_id = $2 ORDER BY is_default DESC, name`, [c.organizationId, c.userId]))
    .rows.map((row) => ({ id: row.id, name: row.name, filters: row.filters, isDefault: row.is_default }));
}

// ------------------------------------------------------------------ progress, rebuilt from the status history
// The project's task progress at the end of each week: for each task, its last status on or before that day (from the append-only events), so
// a past figure never changes when a task changes today. Cancelled tasks drop out; checklist items never count.
export async function getTaskProgressHistory(client, c, projectId, { weeks = 12 } = {}) {
  const { project } = await projectTaskScope(client, c, projectId);
  const tz = (await client.query(`SELECT COALESCE(timezone, 'UTC') AS tz FROM public.organizations WHERE id = $1`, [c.organizationId])).rows[0].tz;
  const events = (await client.query(`SELECT task_id, to_status, to_char((occurred_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS day, occurred_at FROM tenant.project_task_events
     WHERE organization_id = $1 AND project_id = $2 AND to_status IS NOT NULL ORDER BY occurred_at`, [c.organizationId, project.id, tz])).rows;
  const today = await orgDay(client, c);
  const points = [];
  const count = Math.min(Math.max(Number(weeks) || 12, 1), 104);
  for (let index = count - 1; index >= 0; index -= 1) {
    const at = new Date(Date.parse(`${today}T00:00:00Z`) - index * 7 * 864e5).toISOString().slice(0, 10);
    const state = new Map();
    for (const event of events) if (event.day <= at) state.set(event.task_id, event.to_status);
    const active = [...state.values()].filter((status) => status !== "CANCELLED");
    const done = active.filter((status) => status === "DONE").length;
    points.push({ date: at, total: active.length, done, percent: active.length ? Math.floor((done / active.length) * 100) : null });
  }
  return points;
}

// ------------------------------------------------------------------ reports
export const TASK_REPORTS = Object.freeze(["by-project", "my-open", "by-status", "by-assignee", "overdue", "due-soon", "high-priority", "blocked", "in-review", "by-milestone",
  "completion-trend", "reassignments", "completion-evidence"]);
export async function getTaskReport(client, c, kind = "by-project", filters = {}) {
  if (!TASK_REPORTS.includes(kind)) throw err(400, "TASK_INPUT_INVALID", "Unknown task report.");
  if (!has(c, PROJECT.taskView)) throw err(403, "TASK_PERMISSION_DENIED");
  const queue = (view, extra = {}) => listTaskQueue(client, c, { view, pageSize: 500, ...filters, ...extra }).then((result) => result.rows);
  if (kind === "my-open") return queue("mine");
  if (kind === "overdue") return queue("overdue");
  if (kind === "due-soon") return queue("due_soon");
  if (kind === "high-priority") return (await queue("open")).filter((row) => ["HIGH", "URGENT"].includes(row.priority));
  if (kind === "blocked") return queue("blocked");
  if (kind === "in-review") return queue("in_review");
  const values = [c.organizationId, c.userId ?? null];
  const visible = `project.deleted_at IS NULL AND ${visibilitySql(c, "project", "$2")}`;
  const tz = `COALESCE((SELECT timezone FROM public.organizations WHERE id = $1), 'UTC')`;
  const projectFilter = filters.projectId ? (values.push(uuid(filters.projectId, "Project")), ` AND task.project_id = $${values.length}`) : "";
  const counts = `count(*) FILTER (WHERE task.status <> 'CANCELLED')::int AS total, count(*) FILTER (WHERE task.status = 'DONE')::int AS done,
      count(*) FILTER (WHERE task.status IN ('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'))::int AS open, count(*) FILTER (WHERE task.status = 'BLOCKED')::int AS blocked,
      count(*) FILTER (WHERE task.status IN ('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW') AND task.due_date < (now() AT TIME ZONE ${tz})::date)::int AS overdue`;
  const base = `FROM tenant.project_tasks task JOIN tenant.projects project ON project.id = task.project_id WHERE task.organization_id = $1 AND task.archived_at IS NULL AND ${visible}${projectFilter}`;
  if (kind === "by-project") {
    return (await client.query(`SELECT project.id, project.project_code, project.name, ${counts} ${base} GROUP BY project.id, project.project_code, project.name ORDER BY project.project_code`, values)).rows
      .map((row) => ({ projectId: row.id, projectCode: row.project_code, projectName: row.name, total: row.total, done: row.done, open: row.open, blocked: row.blocked, overdue: row.overdue,
        percent: row.total ? Math.floor((row.done / row.total) * 100) : null }));
  }
  if (kind === "by-status") {
    const rows = (await client.query(`SELECT task.status, count(*)::int AS n ${base} GROUP BY task.status`, values)).rows;
    return Object.keys(TASK_STATUS_LABEL).map((status) => ({ status, label: TASK_STATUS_LABEL[status], total: rows.find((row) => row.status === status)?.n ?? 0 }));
  }
  if (kind === "by-assignee") {
    const rows = (await client.query(`SELECT task.assignee_user_id, ${counts}, COALESCE(sum(task.estimate_minutes) FILTER (WHERE task.status IN ('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW')), 0)::int AS open_estimate
        ${base} GROUP BY task.assignee_user_id`, values)).rows;
    const names = await userNames(client, rows.map((row) => row.assignee_user_id));
    return rows.map((row) => ({ assigneeId: row.assignee_user_id, assignee: names.get(row.assignee_user_id) ?? "Unknown", open: row.open, overdue: row.overdue, blocked: row.blocked, done: row.done,
      openEstimateMinutes: row.open_estimate })).sort((a, b) => b.open - a.open || a.assignee.localeCompare(b.assignee));
  }
  if (kind === "by-milestone") {
    return (await client.query(`SELECT milestone.id, milestone.milestone_code, milestone.name, milestone.status AS milestone_status, project.project_code, ${counts}
        FROM tenant.project_tasks task JOIN tenant.projects project ON project.id = task.project_id JOIN tenant.project_milestones milestone ON milestone.id = task.milestone_id
       WHERE task.organization_id = $1 AND task.archived_at IS NULL AND ${visible}${projectFilter}
       GROUP BY milestone.id, milestone.milestone_code, milestone.name, milestone.status, project.project_code ORDER BY project.project_code, milestone.milestone_code`, values)).rows
      .map((row) => ({ milestoneId: row.id, code: row.milestone_code, name: row.name, milestoneStatus: row.milestone_status, milestoneStatusLabel: MILESTONE_STATUS_LABEL[row.milestone_status],
        projectCode: row.project_code, total: row.total, done: row.done, open: row.open, percent: row.total ? Math.floor((row.done / row.total) * 100) : null }));
  }
  if (kind === "completion-trend") {
    // Tasks that reached Done each week (from the history: a reopened-and-redone task counts in each week it was done).
    const rows = (await client.query(`SELECT to_char(date_trunc('week', (event.occurred_at AT TIME ZONE ${tz}))::date, 'YYYY-MM-DD') AS week, count(*)::int AS done
        FROM tenant.project_task_events event JOIN tenant.projects project ON project.id = event.project_id
       WHERE event.organization_id = $1 AND event.to_status = 'DONE' AND ${visible}${projectFilter.replace("task.project_id", "event.project_id")}
         AND event.occurred_at > now() - interval '12 weeks' GROUP BY 1 ORDER BY 1`, values)).rows;
    return rows.map((row) => ({ week: row.week, done: row.done }));
  }
  if (kind === "reassignments") {
    const rows = (await client.query(`SELECT event.*, task.task_code, task.title, project.project_code FROM tenant.project_task_events event JOIN tenant.project_tasks task ON task.id = event.task_id
        JOIN tenant.projects project ON project.id = task.project_id WHERE event.organization_id = $1 AND event.action = 'REASSIGNED' AND ${visible}${projectFilter}
       ORDER BY event.occurred_at DESC LIMIT 500`, values)).rows;
    const names = await userNames(client, rows.flatMap((row) => [row.actor_user_id, row.details?.from, row.details?.to]));
    return rows.map((row) => ({ taskId: row.task_id, code: row.task_code, title: row.title, projectCode: row.project_code, from: names.get(row.details?.from) ?? null, to: names.get(row.details?.to) ?? null,
      reason: row.details?.note ?? null, actor: names.get(row.actor_user_id) ?? null, at: row.occurred_at }));
  }
  // completion-evidence: done tasks with what shows they were done.
  const rows = (await client.query(`SELECT task.*, project.project_code,
      (SELECT count(*) FROM public.attachments file WHERE file.organization_id = task.organization_id AND file.entity_type = 'projects.task' AND file.entity_id = task.id::text AND file.is_current AND file.lifecycle_status <> 'archived')::int AS files,
      (SELECT count(*) FROM tenant.project_task_checklist_items item WHERE item.task_id = task.id AND item.removed_at IS NULL AND item.status = 'DONE')::int AS checklist_done,
      (SELECT count(*) FROM tenant.project_task_checklist_items item WHERE item.task_id = task.id AND item.removed_at IS NULL AND item.status = 'WAIVED')::int AS checklist_waived,
      (SELECT decision.decided_by FROM tenant.project_task_review_decisions decision WHERE decision.review_id = task.current_review_id AND decision.decision = 'APPROVED') AS approved_by
     ${base} AND task.status = 'DONE' ORDER BY task.completed_at DESC LIMIT 500`, values)).rows;
  const names = await userNames(client, rows.flatMap((row) => [row.completed_by, row.approved_by]));
  return rows.map((row) => ({ taskId: row.id, code: row.task_code, title: row.title, projectCode: row.project_code, completedAt: row.completed_at, completedBy: names.get(row.completed_by) ?? null,
    approvedBy: names.get(row.approved_by) ?? null, note: row.completion_note, reference: row.evidence_reference, files: row.files, checklistDone: row.checklist_done, checklistWaived: row.checklist_waived }));
}
const csvCell = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export async function exportProjectTasks(client, c, filters = {}) {
  if (!has(c, PROJECT.taskExport)) throw err(403, "TASK_PERMISSION_DENIED");
  const rows = [];
  for (let page = 1; page <= 40; page += 1) {
    const result = await listTaskQueue(client, c, { ...filters, page, pageSize: 500 });
    rows.push(...result.rows);
    if (page >= result.pages) break;
  }
  const header = ["Code", "Task", "Project", "Milestone", "Assigned to", "Status", "Review", "Priority", "Type", "Due", "Original due", "Overdue", "Checklist", "Tags", "Completed"];
  const lines = rows.map((row) => [row.code, row.title, row.projectCode, row.milestone?.code ?? "", row.assignee, row.statusLabel, row.approvalLabel, row.priority, row.typeLabel, row.dueDate,
    row.originalDueDate, row.overdue ? "Yes" : "No", row.checklist.total ? `${row.checklist.done}/${row.checklist.total}` : "", row.tags.join(" "), row.completedAt ? isoDay(row.completedAt) : ""]);
  return { fileName: `tasks-${await orgDay(client, c)}.csv`, csv: [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n"), count: rows.length };
}

// ------------------------------------------------------------------ reminders (each once per due date)
export async function evaluateTaskDeadlines(client, c) {
  const today = await orgDay(client, c);
  const before = await reminderDays(client, c);
  const rows = (await client.query(`SELECT task.*, project.manager_user_id, project.project_code FROM tenant.project_tasks task JOIN tenant.projects project ON project.id = task.project_id
     WHERE task.organization_id = $1 AND task.status IN ('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW') AND task.archived_at IS NULL AND project.status = 'IN_PROGRESS' AND project.deleted_at IS NULL`,
    [c.organizationId])).rows;
  const once = async (row, key) => Boolean((await client.query(`INSERT INTO tenant.project_alerts (organization_id, project_id, alert_key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id`,
    [c.organizationId, row.project_id, key])).rows[0]);
  const tell = async (row, userIds, title, message) => {
    for (const userId of new Set(userIds.filter(Boolean))) {
      await createNotification(client, { organizationId: c.organizationId, userId, category: "project_task_alert", title, message, href: `/projects/tasks/${row.id}`, entityType: TASK_ENTITY, entityId: row.id });
    }
  };
  let sent = 0;
  for (const row of rows) {
    const due = day(row.due_date);
    const left = daysBetween(today, due);
    if (left < 0 && await once(row, `task:${row.id}:overdue:${due}`)) {
      // Overdue: the assignee, and the Project Manager (the escalation).
      await tell(row, [row.assignee_user_id, row.manager_user_id], `${row.task_code} is overdue`, `${row.title} (${row.project_code}) was due on ${due}.`);
      sent += 1;
    } else if (left >= 0 && left <= before && await once(row, `task:${row.id}:due:${due}`)) {
      await tell(row, [row.assignee_user_id], left === 0 ? `${row.task_code} is due today` : `${row.task_code} is due in ${left} day(s)`, `${row.title} (${row.project_code}) — due ${due}.`);
      sent += 1;
    }
  }
  return { checked: rows.length, sent };
}

// ------------------------------------------------------------------ the project's task work (progress, health, completion check)
// One rule: a cancelled task drops out; every other task counts once (checklist items never; a task under a milestone is still one task).
registerProjectWorkSource(async (client, c, projectIds, map) => {
  if (!projectIds.length) return;
  const today = await orgDay(client, c);
  const rows = (await client.query(`SELECT project_id, count(*)::int AS total, count(*) FILTER (WHERE status = 'DONE')::int AS completed,
      count(*) FILTER (WHERE status IN ('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW'))::int AS open,
      count(*) FILTER (WHERE status IN ('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW') AND due_date < $3::date)::int AS overdue,
      count(*) FILTER (WHERE status IN ('TO_DO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW') AND due_date < $3::date AND priority = 'URGENT')::int AS overdue_critical,
      count(*) FILTER (WHERE status = 'BLOCKED')::int AS blocked
     FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = ANY($2::uuid[]) AND status <> 'CANCELLED' GROUP BY project_id`, [c.organizationId, projectIds, today])).rows;
  for (const id of projectIds) {
    const row = rows.find((entry) => entry.project_id === id);
    const work = map.get(id);
    if (!work) continue;
    work.tasks = { total: row?.total ?? 0, completed: row?.completed ?? 0, open: row?.open ?? 0, overdue: row?.overdue ?? 0, overdueCritical: row?.overdue_critical ?? 0, openRequired: row?.open ?? 0,
      blocked: row?.blocked ?? 0 };
  }
});

// ------------------------------------------------------------------ the milestones' task source
// Milestones count project tasks toward their deliverables through this source; linking from the milestone page files the task under it.
registerMilestoneTaskSource({
  load: async (client, c, projectId, taskIds) => {
    if (!taskIds.length) return new Map();
    const rows = (await client.query(`SELECT id, project_id, task_code, title, status FROM tenant.project_tasks WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [c.organizationId, taskIds])).rows;
    return new Map(rows.map((row) => [row.id, { id: row.id, projectId: row.project_id, title: row.title, code: row.task_code, status: TASK_STATUS_LABEL[row.status], completed: row.status === "DONE",
      cancelled: row.status === "CANCELLED" }]));
  },
  search: async (client, c, projectId, term) => {
    const values = [c.organizationId, projectId];
    let filter = "";
    if (term) { values.push(`%${String(term).replace(/[%_]/g, "\\$&")}%`); filter = ` AND (title ILIKE $3 OR task_code ILIKE $3)`; }
    return (await client.query(`SELECT id, task_code, title, status FROM tenant.project_tasks WHERE organization_id = $1 AND project_id = $2 AND status <> 'CANCELLED' AND archived_at IS NULL${filter}
       ORDER BY due_date LIMIT 50`, values)).rows.map((row) => ({ id: row.id, code: row.task_code, title: row.title, status: TASK_STATUS_LABEL[row.status] }));
  },
  attach: async (client, c, taskId, milestoneId) => {
    await client.query(`UPDATE tenant.project_tasks SET milestone_id = $3, row_version = row_version + 1, updated_at = now(), updated_by = $4 WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, taskId, milestoneId, c.userId ?? null]);
    await client.query(`INSERT INTO tenant.project_task_events (organization_id, task_id, project_id, action, summary, actor_user_id)
       SELECT organization_id, id, project_id, $3, $4, $5 FROM tenant.project_tasks WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, taskId, milestoneId ? "MILESTONE_LINKED" : "MILESTONE_UNLINKED", milestoneId ? "Filed under a milestone (from the milestone)" : "Removed from its milestone (from the milestone)", c.userId ?? null]);
  },
});
