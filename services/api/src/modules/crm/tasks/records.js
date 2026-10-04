// A task: what has to be done, by whom and by when, and usually which lead,
// account, contact or opportunity it is about. Reading, listing, creating,
// editing and deleting; the lifecycle (assign, start, complete, reopen,
// cancel) is in lifecycle.js.
//
// A task is a row of tenant.crm_activities with activity_type = 'task', the
// table every CRM timeline already reads. Its history is append-only in
// tenant.crm_task_history.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { resolveMemberExecutionContext } from "../../../core/platform/reporting/execution-context.js";
import { replaceActivityReminder } from "../reminders/index.js";
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { assertEligibleLeadAssignee } from "../leads/assignment.js";
import { canViewAllTasks, requireTaskPermission, taskCan, taskCapabilities, taskRelatedScopeSql, taskScopeSql } from "./access.js";
import {
  OPEN_STORED_STATUSES, TASK_NUMBER_DOCUMENT_TYPE, TASK_PERMISSIONS, TASK_PRIORITIES, TASK_RELATED_TYPES, TASK_STATUSES, TASK_VIEWS,
} from "./constants.js";
import { recordTaskHistory } from "./history.js";
import { notifyTaskAssigned } from "./notify.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const PRIORITY_CODES = TASK_PRIORITIES.map((entry) => entry.code);
const RELATED_CODES = TASK_RELATED_TYPES.map((entry) => entry.code);
const OPEN = `task.status IN (${OPEN_STORED_STATUSES.map((status) => `'${status}'`).join(", ")})`;
const text = (value) => String(value ?? "").trim();
const has = (input, field) => Object.prototype.hasOwnProperty.call(input ?? {}, field);
export const isUuid = (value) => UUID.test(String(value ?? ""));
const invalid = (message, field) => new CrmError(400, message, "CRM_TASK_VALIDATION", { issues: [{ field, message }] });

export function requireUuid(value, label) {
  if (!isUuid(value)) throw new CrmError(400, `${label} is invalid.`, "CRM_TASK_VALIDATION");
  return String(value);
}

// The calendar day and time of the due moment, in the organization's time zone.
export const TASK_SELECT = `
  SELECT task.*, organization.timezone AS organization_timezone,
         assignee.full_name AS assigned_name, creator.full_name AS created_by_name, updater.full_name AS updated_by_name,
         completer.full_name AS completed_by_name, canceller.full_name AS cancelled_by_name,
         to_char(task.due_at AT TIME ZONE organization.timezone, 'YYYY-MM-DD') AS due_on,
         CASE WHEN task.due_time_set THEN to_char(task.due_at AT TIME ZONE organization.timezone, 'HH24:MI') END AS due_time_of_day,
         ((task.due_at AT TIME ZONE organization.timezone)::date = (now() AT TIME ZONE organization.timezone)::date) AS due_today,
         ((task.due_at AT TIME ZONE organization.timezone)::date > (now() AT TIME ZONE organization.timezone)::date) AS due_later,
         (task.due_at < now()) AS past_due,
         COALESCE(lead.company_name, NULLIF(btrim(concat_ws(' ', lead.first_name, lead.last_name)), '')) AS lead_name, lead.code AS lead_code,
         opportunity.name AS opportunity_name, opportunity.code AS opportunity_code,
         contact.display_name AS contact_name,
         COALESCE(direct_account.id, opportunity_account.id, contact_account.id) AS account_id,
         COALESCE(direct_account.display_name, opportunity_account.display_name, contact_account.display_name) AS account_name,
         campaign.name AS campaign_name
    FROM tenant.crm_activities task
    JOIN public.organizations organization ON organization.id = task.organization_id
    LEFT JOIN public.users assignee ON assignee.id = task.assigned_to
    LEFT JOIN public.users creator ON creator.id = task.created_by
    LEFT JOIN public.users updater ON updater.id = task.updated_by
    LEFT JOIN public.users completer ON completer.id = task.completed_by
    LEFT JOIN public.users canceller ON canceller.id = task.cancelled_by
    LEFT JOIN tenant.crm_leads lead ON task.entity_type = 'lead' AND lead.organization_id = task.organization_id AND lead.id = task.entity_id
    LEFT JOIN tenant.crm_opportunities opportunity ON task.entity_type = 'opportunity' AND opportunity.organization_id = task.organization_id AND opportunity.id = task.entity_id
    LEFT JOIN tenant.contacts contact ON task.entity_type = 'contact' AND contact.organization_id = task.organization_id AND contact.id = task.entity_id
    LEFT JOIN tenant.business_parties direct_account ON task.entity_type = 'party' AND direct_account.organization_id = task.organization_id AND direct_account.id = task.entity_id
    LEFT JOIN tenant.business_parties opportunity_account ON opportunity_account.organization_id = task.organization_id AND opportunity_account.id = opportunity.party_id
    LEFT JOIN tenant.business_parties contact_account ON contact_account.organization_id = task.organization_id AND contact_account.id = contact.party_id
    LEFT JOIN tenant.crm_campaigns campaign ON task.entity_type = 'campaign' AND campaign.organization_id = task.organization_id AND campaign.id = task.entity_id`;

const STATUS_OF = Object.freeze({ planned: "open", overdue: "open", in_progress: "in_progress", completed: "completed", cancelled: "cancelled" });
const RELATED_PATH = Object.freeze({ lead: "/crm/leads", opportunity: "/crm/opportunities", party: "/crm/accounts", contact: "/crm/contacts" });

export function toTask(row) {
  const status = STATUS_OF[row.status] ?? "open";
  const open = status === "open" || status === "in_progress";
  const relatedName = { lead: row.lead_name, opportunity: row.opportunity_name, party: row.account_name, contact: row.contact_name, campaign: row.campaign_name }[row.entity_type] ?? null;
  return {
    id: row.id,
    number: row.task_number ?? null,
    title: row.subject,
    description: row.description,
    status,
    priority: PRIORITY_CODES.includes(row.priority) ? row.priority : "high",
    relatedType: row.entity_id ? row.entity_type : null,
    relatedId: row.entity_id ?? null,
    relatedName,
    relatedCode: row.entity_type === "lead" ? row.lead_code : row.entity_type === "opportunity" ? row.opportunity_code : null,
    relatedHref: row.entity_id && RELATED_PATH[row.entity_type] ? `${RELATED_PATH[row.entity_type]}/${row.entity_id}` : null,
    // the account behind the record: the account itself, or the account of the opportunity or contact
    accountId: row.account_id ?? null,
    accountName: row.account_name ?? null,
    assignedTo: row.assigned_to,
    assignedName: row.assigned_name ?? null,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    dueAt: row.due_at,
    dueDate: row.due_on ?? null,
    dueTime: row.due_time_of_day ?? null,
    reminderOffsetMinutes: row.reminder_offset_minutes ?? null,
    reminderAt: row.reminder_at,
    // calculated, never stored as a status
    isOverdue: open && row.past_due === true,
    isDueToday: open && row.due_today === true,
    isUpcoming: open && row.due_later === true,
    completedAt: row.completed_at,
    completedByName: row.completed_by_name ?? null,
    completionNote: row.outcome,
    cancelledAt: row.cancelled_at,
    cancelledByName: row.cancelled_by_name ?? null,
    cancellationReason: row.cancellation_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedByName: row.updated_by_name ?? null,
  };
}

// ------------------------------------------------------------------ read

async function loadTaskRow(client, context, taskId, { lock = false } = {}) {
  const values = [context.organizationId, requireUuid(taskId, "Task")];
  const scope = taskScopeSql(context, values, "task");
  const { rows } = await client.query(
    `${TASK_SELECT} WHERE task.organization_id = $1 AND task.id = $2 AND task.activity_type = 'task'${scope}${lock ? " FOR UPDATE OF task" : ""}`,
    values,
  );
  if (!rows[0]) throw new CrmError(404, "Task not found.", "CRM_TASK_NOT_FOUND");
  return rows[0];
}

// The task as just written, for its notification: the caller may no longer see it.
export async function readTaskForNotice(client, context, taskId) {
  const { rows } = await client.query(`${TASK_SELECT} WHERE task.organization_id = $1 AND task.id = $2`, [context.organizationId, taskId]);
  return rows[0] ? toTask(rows[0]) : null;
}

export async function lockTask(client, context, taskId) {
  requireTaskPermission(context, TASK_PERMISSIONS.view, "You do not have permission to view tasks.");
  return loadTaskRow(client, context, taskId, { lock: true });
}

export async function getTask(client, context, taskId) {
  requireTaskPermission(context, TASK_PERMISSIONS.view, "You do not have permission to view tasks.");
  return toTask(await loadTaskRow(client, context, taskId));
}

export function assertNotStale(row, expectedUpdatedAt) {
  if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== new Date(row.updated_at).getTime())
    throw new CrmError(409, "This task was changed by someone else. Reload it and try again.", "CRM_TASK_STALE_WRITE");
}

export const isOpenRow = (row) => OPEN_STORED_STATUSES.includes(row.status);

export function assertOpen(row, action) {
  if (!isOpenRow(row)) throw new CrmError(409, `This task is ${STATUS_OF[row.status]}. Reopen it before it can be ${action}.`, "CRM_TASK_CLOSED");
}

// ------------------------------------------------------------------ list

const SORTS = Object.freeze({
  // open work first, then by when it is due: overdue, today, upcoming
  smart: `CASE WHEN ${OPEN} THEN 0 ELSE 1 END, task.due_at ASC NULLS LAST, task.created_at DESC`,
  dueAt: "task.due_at",
  priority: "CASE task.priority WHEN 'high' THEN 3 WHEN 'urgent' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END",
  createdAt: "task.created_at",
  updatedAt: "task.updated_at",
  assignee: "lower(assignee.full_name)",
  title: "lower(task.subject)",
});

// The WHERE clause shared by the list, the export and the summary.
export function buildTaskListWhere(context, filters = {}, values = []) {
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = [`task.organization_id = ${bind(context.organizationId)}`, "task.activity_type = 'task'"];
  const view = filters.view || "mine";
  const me = () => bind(context.userId);
  const localToday = "(now() AT TIME ZONE organization.timezone)::date";
  const localDue = "(task.due_at AT TIME ZONE organization.timezone)::date";
  if (["mine", "due_today", "upcoming", "overdue", "high_priority", "completed"].includes(view)) where.push(`task.assigned_to = ${me()}`);
  if (["mine", "due_today", "upcoming", "overdue", "high_priority", "team"].includes(view)) where.push(OPEN);
  if (view === "due_today") where.push(`${localDue} = ${localToday}`);
  if (view === "upcoming") where.push(`${localDue} > ${localToday}`);
  if (view === "overdue") where.push("task.due_at < now()");
  if (view === "high_priority") where.push("task.priority IN ('high', 'urgent')");
  if (view === "completed") where.push("task.status = 'completed'");
  if (view === "cancelled") where.push("task.status = 'cancelled'");
  if (view === "created_by_me") where.push(`task.created_by = ${me()}`);
  if (view === "team") {
    const caller = me();
    where.push(canViewAllTasks(context) ? `task.assigned_to IS DISTINCT FROM ${caller}` : `task.assigned_to IN (SELECT member.user_id FROM tenant.crm_sales_team_members member
      JOIN tenant.crm_sales_teams team ON team.organization_id = member.organization_id AND team.id = member.team_id AND team.status = 'active'
     WHERE member.organization_id = task.organization_id AND member.status = 'active' AND team.manager_user_id = ${caller} AND member.user_id <> ${caller})`);
  }

  // "overdue" is a calculated filter: still to do, and past its due time.
  const status = {
    open: "task.status IN ('planned', 'overdue')", in_progress: "task.status = 'in_progress'", completed: "task.status = 'completed'",
    cancelled: "task.status = 'cancelled'", overdue: `${OPEN} AND task.due_at < now()`,
  }[filters.status];
  if (status) where.push(status);
  if (PRIORITY_CODES.includes(filters.priority)) where.push(filters.priority === "high" ? "task.priority IN ('high', 'urgent')" : `task.priority = ${bind(filters.priority)}`);
  if (filters.assigneeId === "me") where.push(`task.assigned_to = ${me()}`);
  else if (filters.assigneeId === "unassigned") where.push("task.assigned_to IS NULL");
  else if (isUuid(filters.assigneeId)) where.push(`task.assigned_to = ${bind(filters.assigneeId)}`);
  if (filters.createdBy === "me") where.push(`task.created_by = ${me()}`);
  else if (isUuid(filters.createdBy)) where.push(`task.created_by = ${bind(filters.createdBy)}`);
  if (filters.relatedType === "none") where.push("task.entity_id IS NULL");
  else if (RELATED_CODES.includes(filters.relatedType)) where.push(`task.entity_type = ${bind(filters.relatedType)}`);
  if (isUuid(filters.relatedId)) where.push(`task.entity_id = ${bind(filters.relatedId)}`);
  for (const [key, type] of Object.entries({ leadId: "lead", opportunityId: "opportunity", contactId: "contact" }))
    if (isUuid(filters[key])) where.push(`task.entity_type = '${type}' AND task.entity_id = ${bind(filters[key])}`);
  // An account's tasks: on the account, and on its opportunities and contacts.
  if (isUuid(filters.accountId)) where.push(`COALESCE(direct_account.id, opportunity_account.id, contact_account.id) = ${bind(filters.accountId)}`);
  for (const [key, sql] of Object.entries({
    dueFrom: `${localDue} >= $::date`, dueTo: `${localDue} <= $::date`,
    createdFrom: "task.created_at >= $::date", createdTo: "task.created_at < $::date + interval '1 day'",
  })) if (DATE.test(String(filters[key] ?? ""))) where.push(sql.replace("$", bind(filters[key])));
  if (Array.isArray(filters.ids) && filters.ids.length) where.push(`task.id = ANY (${bind(filters.ids.filter(isUuid))}::uuid[])`);
  const search = text(filters.search).toLowerCase();
  if (search) where.push(`lower(task.subject || ' ' || COALESCE(task.task_number, '')) LIKE ${bind(`%${search.replace(/[\\%_]/g, "\\$&")}%`)}`);
  return `WHERE ${where.join(" AND ")}${taskScopeSql(context, values, "task")}`;
}

export async function listTasks(client, context, filters = {}) {
  requireTaskPermission(context, TASK_PERMISSIONS.view, "You do not have permission to view tasks.");
  const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const sortKey = SORTS[filters.sortBy] ? filters.sortBy : "smart";
  const direction = String(filters.sortDirection).toLowerCase() === "desc" ? "DESC" : "ASC";
  const order = sortKey === "smart" ? SORTS.smart : `${SORTS[sortKey]} ${direction} NULLS LAST, task.created_at DESC`;
  const values = [];
  const where = buildTaskListWhere(context, filters, values);
  const total = await client.query(`SELECT count(*)::int AS total FROM (${TASK_SELECT} ${where}) counted`, values);
  const { rows } = await client.query(`${TASK_SELECT} ${where} ORDER BY ${order}, task.id LIMIT ${limit} OFFSET ${offset}`, values);
  return { tasks: rows.map(toTask), total: total.rows[0].total, limit, offset, capabilities: taskCapabilities(context) };
}

// What is waiting for the caller, and for a manager, how much of the team's work is late.
export async function getTaskSummary(client, context) {
  requireTaskPermission(context, TASK_PERMISSIONS.view, "You do not have permission to view tasks.");
  const count = async (view, extra = {}) => {
    const values = [];
    const where = buildTaskListWhere(context, { view, ...extra }, values);
    return (await client.query(`SELECT count(*)::int AS total FROM (${TASK_SELECT} ${where}) counted`, values)).rows[0].total;
  };
  const managesTeam = canViewAllTasks(context) || taskCan(context, TASK_PERMISSIONS.viewTeam);
  return {
    overdue: await count("overdue"),
    dueToday: await count("due_today"),
    upcoming: await count("upcoming"),
    highPriority: await count("high_priority"),
    open: await count("mine"),
    teamOverdue: managesTeam ? await count("team", { status: "overdue" }) : null,
  };
}

// ------------------------------------------------------------------ validation

// The record a task is about: one the caller can see, in this organization.
async function requireRelated(client, context, type, id) {
  if (!type && !id) return null;
  if (!RELATED_CODES.includes(type)) throw invalid("Choose what the task is about: a lead, account, contact or opportunity.", "relatedType");
  const values = [context.organizationId, requireUuid(id, "Related record")];
  const row = { entity_type: type, entity_id: id };
  const scope = taskRelatedScopeSql(context, values, "task");
  const { rows } = await client.query(`SELECT 1 FROM (SELECT $1::uuid AS organization_id, $2::uuid AS entity_id, '${type}'::text AS entity_type) task WHERE true${scope}`, values);
  if (!rows[0]) throw new CrmError(404, "The related record was not found, or you do not have access to it.", "CRM_TASK_RELATED_INVALID");
  return row;
}

// The assignee must be an active member with CRM access who can see the task, and so the record it is about.
async function requireAssignee(client, context, userId, related) {
  if (!userId) throw invalid("Every task needs someone to do it.", "assignedTo");
  await assertEligibleLeadAssignee(client, context, requireUuid(userId, "Assignee")).catch((error) => {
    throw new CrmError(409, error.message, "CRM_TASK_ASSIGNEE_INVALID");
  });
  if (userId === context.userId) return;
  const assignee = await resolveMemberExecutionContext(client, context.organizationId, { userId });
  if (!assignee || !taskCan(assignee, TASK_PERMISSIONS.view)) throw new CrmError(409, "This person does not have access to CRM tasks.", "CRM_TASK_ASSIGNEE_INVALID");
  if (related) {
    const values = [context.organizationId, related.entity_id];
    const scope = taskRelatedScopeSql(assignee, values, "task");
    const { rows } = await client.query(`SELECT 1 FROM (SELECT $1::uuid AS organization_id, $2::uuid AS entity_id, '${related.entity_type}'::text AS entity_type) task WHERE true${scope}`, values);
    if (!rows[0]) throw new CrmError(409, "This person cannot see the record the task is about. Choose someone who has access to it.", "CRM_TASK_ASSIGNEE_NO_ACCESS");
  }
}

// For the lifecycle operations: the assignee checks against the task's own record.
export const requireAssigneeFor = (client, context, userId, row) =>
  requireAssignee(client, context, userId, row.entity_id ? { entity_type: row.entity_type, entity_id: row.entity_id } : null);

// dueDate (YYYY-MM-DD) is required; dueTime (HH:MM) is optional. Without a
// time the task is due by the end of that day in the organization's time zone.
async function resolveDue(client, context, dueDate, dueTime) {
  const date = text(dueDate).slice(0, 10);
  if (!DATE.test(date)) throw invalid("Choose the date the task is due.", "dueDate");
  const time = text(dueTime);
  if (time && !TIME.test(time)) throw invalid("Enter the due time as HH:MM.", "dueTime");
  const { rows } = await client.query(
    `SELECT (($2::date + COALESCE($3::time, time '23:59:59')) AT TIME ZONE timezone) AS due_at FROM public.organizations WHERE id = $1`,
    [context.organizationId, date, time || null],
  );
  if (!rows[0]?.due_at || Number.isNaN(new Date(rows[0].due_at).getTime())) throw invalid("Choose a valid due date.", "dueDate");
  return { dueAt: new Date(rows[0].due_at), dueTimeSet: Boolean(time) };
}

// reminderOffsetMinutes: 0, 15, 60, 1440… minutes before the due time, or
// reminderAt: a custom moment. Neither: no reminder. Returns the offset.
function resolveReminder(input, dueAt) {
  if (has(input, "reminderAt") && input.reminderAt) {
    const at = new Date(input.reminderAt);
    if (Number.isNaN(at.getTime())) throw invalid("Choose a valid reminder date and time.", "reminderAt");
    const minutes = Math.round((dueAt.getTime() - at.getTime()) / 60000);
    if (minutes < 0) throw invalid("The reminder must be at or before the due time.", "reminderAt");
    if (minutes > 43200) throw invalid("The reminder can be at most 30 days before the due time.", "reminderAt");
    return minutes;
  }
  const value = input.reminderOffsetMinutes;
  if (value === null || value === undefined || value === "") return null;
  const minutes = Math.trunc(Number(value));
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 43200) throw invalid("Choose a reminder.", "reminderOffsetMinutes");
  return minutes;
}

// Replaces the task's pending reminder. Only one per task, and only one row per
// moment: a retried request or a double click never adds a second.
export async function scheduleTaskReminder(client, context, taskId, dueAt, offsetMinutes) {
  await replaceActivityReminder(client, context, taskId, dueAt, offsetMinutes);
}

function validTitle(value) {
  const title = text(value);
  if (!title) throw invalid("Enter what needs to be done.", "title");
  if (title.length > 300) throw invalid("Use 300 characters or fewer.", "title");
  return title;
}
function validDescription(value) {
  const description = text(value);
  if (description.length > 4000) throw invalid("Use 4,000 characters or fewer.", "description");
  return description || null;
}
function validPriority(value) {
  const priority = text(value).toLowerCase() || "medium";
  if (!PRIORITY_CODES.includes(priority)) throw invalid("Priority must be low, medium or high.", "priority");
  return priority;
}

// ------------------------------------------------------------------ create

// input: { title, description?, priority?, dueDate, dueTime?, reminderOffsetMinutes? | reminderAt?,
//          relatedType?, relatedId?, assignedTo?, idempotencyKey? }
// The task is yours unless assignedTo names someone else. A repeated request
// with the same idempotencyKey returns the task the first one created.
export async function createTask(client, context, input = {}) {
  requireTaskPermission(context, TASK_PERMISSIONS.create, "You do not have permission to create tasks.");
  const key = text(input.idempotencyKey).slice(0, 120);
  if (key) {
    const { rows } = await client.query(`SELECT id FROM tenant.crm_activities WHERE organization_id = $1 AND activity_type = 'task' AND external_id = $2`, [context.organizationId, `task:${key}`]);
    if (rows[0]) return getTask(client, context, rows[0].id);
  }
  const title = validTitle(input.title);
  const description = validDescription(input.description);
  const priority = validPriority(input.priority);
  const related = await requireRelated(client, context, input.relatedType || null, input.relatedId || null);
  const assignedTo = input.assignedTo || context.userId;
  if (assignedTo !== context.userId) requireTaskPermission(context, TASK_PERMISSIONS.assign, "You do not have permission to give tasks to other people.");
  await requireAssignee(client, context, assignedTo, related);
  // dueAt (an exact moment) is accepted from the mobile app's offline queue.
  const { dueAt, dueTimeSet } = !input.dueDate && input.dueAt && !Number.isNaN(new Date(input.dueAt).getTime())
    ? { dueAt: new Date(input.dueAt), dueTimeSet: true }
    : await resolveDue(client, context, input.dueDate, input.dueTime);
  const reminderOffset = resolveReminder(input, dueAt);
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: TASK_NUMBER_DOCUMENT_TYPE });

  const { rows } = await client.query(
    `INSERT INTO tenant.crm_activities (organization_id, entity_type, entity_id, activity_type, subject, description, status, priority, assigned_to,
                                        due_at, due_time_set, reminder_offset_minutes, reminder_at, task_number, external_id, created_by, updated_by)
     VALUES ($1, $2, $3, 'task', $4, $5, 'planned', $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
     RETURNING id`,
    [context.organizationId, related?.entity_type ?? "general", related?.entity_id ?? null, title, description, priority, assignedTo, dueAt, dueTimeSet,
      reminderOffset, reminderOffset === null ? null : new Date(dueAt.getTime() - reminderOffset * 60000), number, key ? `task:${key}` : null, context.userId ?? null],
  );
  const taskId = rows[0].id;
  await scheduleTaskReminder(client, context, taskId, dueAt, reminderOffset);
  await recordTaskHistory(client, context, taskId, "created", `Created${related ? "" : " as a personal task"}`, { assignedTo, dueAt, priority });
  const task = await getTask(client, context, taskId);
  if (assignedTo !== context.userId) {
    await recordTaskHistory(client, context, taskId, "assigned", `Assigned to ${task.assignedName}`, { to: assignedTo });
    await notifyTaskAssigned(client, context, task, { reassigned: false });
  }
  await queueOutboxEvent(client, context, "crm.task.created", "tasks", taskId, { assignedTo, relatedType: task.relatedType, relatedId: task.relatedId });
  return task;
}

// ------------------------------------------------------------------ update

// input: any of { title, description, priority, dueDate, dueTime, reminderOffsetMinutes, reminderAt, relatedType, relatedId },
//        plus expectedUpdatedAt. Changing the assignee is assignTask; the status, the lifecycle operations.
export async function updateTask(client, context, taskId, input = {}) {
  requireTaskPermission(context, TASK_PERMISSIONS.edit, "You do not have permission to edit tasks.");
  for (const field of ["status", "assignedTo", "completedAt", "completedBy", "cancelledAt", "cancelledBy", "number", "createdBy"])
    if (has(input, field)) throw new CrmError(409, field === "assignedTo" ? "Use Assign to change who does the task." : "This field is set by the task's own actions.", "CRM_TASK_FIELD_GOVERNED");
  const row = await lockTask(client, context, taskId);
  assertOpen(row, "edited");
  assertNotStale(row, input.expectedUpdatedAt);
  const before = toTask(row);
  const sets = [];
  const values = [context.organizationId, row.id];
  const set = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };
  const events = [];

  if (has(input, "title") || has(input, "description")) {
    const title = has(input, "title") ? validTitle(input.title) : row.subject;
    const description = has(input, "description") ? validDescription(input.description) : row.description;
    if (title !== row.subject || description !== row.description) {
      set("subject", title);
      set("description", description);
      events.push(["updated", title !== row.subject ? `Title: ${row.subject} → ${title}` : "Description changed", { from: row.subject, to: title }]);
    }
  }
  if (has(input, "priority")) {
    const priority = validPriority(input.priority);
    if (priority !== before.priority) {
      set("priority", priority);
      events.push(["priority_changed", `Priority: ${before.priority} → ${priority}`, { from: before.priority, to: priority }]);
    }
  }
  if (has(input, "relatedType") || has(input, "relatedId")) {
    const next = await requireRelated(client, context, input.relatedType || null, input.relatedId || null);
    if ((next?.entity_id ?? null) !== (row.entity_id ?? null)) {
      if (next && row.assigned_to) await requireAssignee(client, context, row.assigned_to, next);
      set("entity_type", next?.entity_type ?? "general");
      set("entity_id", next?.entity_id ?? null);
      events.push(["related_changed", next ? "Linked to another record" : "No longer linked to a record", { fromType: before.relatedType, from: before.relatedId, toType: next?.entity_type ?? null, to: next?.entity_id ?? null }]);
    }
  }
  let dueAt = new Date(row.due_at);
  let rescheduled = false;
  if (has(input, "dueDate") || has(input, "dueTime")) {
    const due = await resolveDue(client, context, has(input, "dueDate") ? input.dueDate : before.dueDate, has(input, "dueTime") ? input.dueTime : before.dueTime);
    if (due.dueAt.getTime() !== dueAt.getTime() || due.dueTimeSet !== row.due_time_set) {
      set("due_at", due.dueAt);
      set("due_time_set", due.dueTimeSet);
      // a new due moment can be overdue again, and announced again
      set("overdue_notified_at", null);
      const label = (date, time) => `${date}${time ? ` ${time}` : ""}`;
      const after = { dueDate: input.dueDate ?? before.dueDate, dueTime: due.dueTimeSet ? text(input.dueTime ?? before.dueTime) : null };
      events.push(["rescheduled", `Due: ${label(before.dueDate, before.dueTime)} → ${label(after.dueDate, after.dueTime)}`, { from: row.due_at, to: due.dueAt, reason: text(input.reason).slice(0, 500) || null }]);
      dueAt = due.dueAt;
      rescheduled = true;
    }
  }
  let reminderOffset = row.reminder_offset_minutes;
  if (has(input, "reminderOffsetMinutes") || has(input, "reminderAt")) {
    reminderOffset = resolveReminder(input, dueAt);
    if (reminderOffset !== row.reminder_offset_minutes) events.push(["reminder_changed", reminderOffset === null ? "Reminder removed" : "Reminder changed", { from: row.reminder_offset_minutes, to: reminderOffset }]);
  }
  if (reminderOffset !== row.reminder_offset_minutes || rescheduled) {
    set("reminder_offset_minutes", reminderOffset);
    set("reminder_at", reminderOffset === null ? null : new Date(dueAt.getTime() - reminderOffset * 60000));
  }
  if (!sets.length) return before;
  values.push(context.userId ?? null);
  await client.query(`UPDATE tenant.crm_activities SET ${sets.join(", ")}, updated_by = $${values.length} WHERE organization_id = $1 AND id = $2`, values);
  if (reminderOffset !== row.reminder_offset_minutes || rescheduled) await scheduleTaskReminder(client, context, row.id, dueAt, reminderOffset);
  for (const [type, summary, changes] of events) await recordTaskHistory(client, context, row.id, type, summary, changes);
  return getTask(client, context, row.id);
}

export const rescheduleTask = (client, context, taskId, input = {}) =>
  updateTask(client, context, taskId, Object.fromEntries(["dueDate", "dueTime", "reminderOffsetMinutes", "reminderAt", "reason", "expectedUpdatedAt"].filter((field) => has(input, field)).map((field) => [field, input[field]])));

// ------------------------------------------------------------------ delete

// Only a task created by mistake can be deleted: never started, completed,
// cancelled, reopened or handed to someone else. Anything else is cancelled,
// so its history stays.
export async function deleteTask(client, context, taskId) {
  requireTaskPermission(context, TASK_PERMISSIONS.delete, "You do not have permission to delete tasks.");
  const row = await lockTask(client, context, taskId);
  const used = await client.query(
    `SELECT EXISTS (SELECT 1 FROM tenant.crm_task_history WHERE organization_id = $1 AND task_id = $2 AND event_type IN ('reassigned', 'started', 'completed', 'reopened', 'cancelled'))
         OR EXISTS (SELECT 1 FROM tenant.crm_activity_reminders WHERE organization_id = $1 AND activity_id = $2 AND status IN ('sent', 'delivered', 'acknowledged')) AS used`,
    [context.organizationId, row.id],
  );
  if (row.status !== "planned" || used.rows[0].used)
    throw new CrmError(409, "This task has been worked on. Cancel it instead, so its history is kept.", "CRM_TASK_IN_USE");
  await client.query(`DELETE FROM tenant.crm_task_history WHERE organization_id = $1 AND task_id = $2`, [context.organizationId, row.id]);
  await client.query(`DELETE FROM tenant.crm_activities WHERE organization_id = $1 AND id = $2 AND activity_type = 'task'`, [context.organizationId, row.id]);
  await queueOutboxEvent(client, context, "crm.task.deleted", "tasks", row.id, {});
  return { deleted: true };
}

// ------------------------------------------------------------------ options

export async function getTaskOptions(client, context) {
  requireTaskPermission(context, TASK_PERMISSIONS.view, "You do not have permission to view tasks.");
  const { listLeadAssignmentOptions } = await import("../leads/assignment.js");
  const { users, teams } = await listLeadAssignmentOptions(client, context);
  const { TASK_REMINDER_OPTIONS } = await import("./constants.js");
  return {
    views: TASK_VIEWS.filter((view) => view.key !== "team" || canViewAllTasks(context) || taskCan(context, TASK_PERMISSIONS.viewTeam))
      .filter((view) => view.key !== "all" || canViewAllTasks(context) || taskCan(context, TASK_PERMISSIONS.viewTeam)),
    statuses: TASK_STATUSES,
    priorities: TASK_PRIORITIES,
    relatedTypes: TASK_RELATED_TYPES,
    reminderOptions: TASK_REMINDER_OPTIONS,
    followUpTypes: ["call", "email", "meeting", "other"],
    users,
    teams,
    currentUserId: context.userId,
    capabilities: taskCapabilities(context),
  };
}
