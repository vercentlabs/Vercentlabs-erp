// What happens to a task: it is assigned, started, completed, reopened or
// cancelled. Each is its own operation, checked and recorded; nobody writes a
// task's status or completion fields directly.
//
// Every operation locks the task first. Repeating one that has already
// happened (a double click on Complete, a retried request) changes nothing
// and records nothing a second time.
import { cancelPendingRemindersForActivity, createCrmFollowUp } from "../activities/follow-ups/follow-up-operations.js";
import { CrmError } from "../data-management/errors.js";
import { queueOutboxEvent } from "../data-management/outbox.js";
import { requireTaskPermission } from "./access.js";
import { TASK_PERMISSIONS } from "./constants.js";
import { listTaskHistoryEntries, recordTaskHistory } from "./history.js";
import { notifyTaskAssigned, notifyTaskCompleted } from "./notify.js";
import { assertNotStale, assertOpen, getTask, isOpenRow, lockTask, requireAssigneeFor, scheduleTaskReminder } from "./records.js";

const text = (value) => String(value ?? "").trim();
const FOLLOW_UP_CHANNELS = new Set(["call", "email", "meeting", "other"]);

// Completing work on a lead or opportunity counts as activity on it.
async function touchRelated(client, context, row) {
  if (row.entity_type === "lead" && row.entity_id)
    await client.query(`UPDATE tenant.crm_leads SET last_activity_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.entity_id]);
  if (row.entity_type === "opportunity" && row.entity_id)
    await client.query(`UPDATE tenant.crm_opportunities SET last_activity_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.entity_id]);
}

// ------------------------------------------------------------------ assign

// input: { assignedTo, reason?, expectedUpdatedAt? }. Who created the task never changes.
export async function assignTask(client, context, taskId, input = {}, { notify = true } = {}) {
  const row = await lockTask(client, context, taskId);
  const reassigning = Boolean(row.assigned_to);
  requireTaskPermission(context, reassigning ? TASK_PERMISSIONS.reassign : TASK_PERMISSIONS.assign,
    reassigning ? "You do not have permission to reassign tasks." : "You do not have permission to assign tasks.");
  assertOpen(row, "reassigned");
  assertNotStale(row, input.expectedUpdatedAt);
  const assignedTo = text(input.assignedTo);
  if (assignedTo === row.assigned_to) return { changed: false };
  await requireAssigneeFor(client, context, assignedTo, row);
  await client.query(
    `UPDATE tenant.crm_activities SET assigned_to = $3, overdue_notified_at = NULL, updated_by = $4 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, assignedTo, context.userId ?? null],
  );
  const task = await getTask(client, context, row.id).catch(() => null);
  const name = task?.assignedName ?? (await client.query(`SELECT full_name FROM public.users WHERE id = $1`, [assignedTo])).rows[0]?.full_name ?? "someone";
  await recordTaskHistory(client, context, row.id, reassigning ? "reassigned" : "assigned",
    reassigning ? `Reassigned: ${row.assigned_name ?? "Unassigned"} → ${name}` : `Assigned to ${name}`,
    { from: row.assigned_to, to: assignedTo, reason: text(input.reason).slice(0, 500) || null });
  if (notify && task) await notifyTaskAssigned(client, context, task, { reassigned: reassigning });
  await queueOutboxEvent(client, context, "crm.task.assigned", "tasks", row.id, { from: row.assigned_to, to: assignedTo });
  return { changed: true, previousAssignee: row.assigned_to, assignedTo };
}

export const reassignTask = assignTask;

// ------------------------------------------------------------------ start, complete

export async function startTask(client, context, taskId, input = {}) {
  requireTaskPermission(context, TASK_PERMISSIONS.edit, "You do not have permission to edit tasks.");
  const row = await lockTask(client, context, taskId);
  if (row.status === "in_progress") return { changed: false };
  assertOpen(row, "started");
  assertNotStale(row, input.expectedUpdatedAt);
  await client.query(`UPDATE tenant.crm_activities SET status = 'in_progress', start_at = COALESCE(start_at, now()), updated_by = $3 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, context.userId ?? null]);
  await recordTaskHistory(client, context, row.id, "started", "Started");
  return { changed: true };
}

// input: { note?, expectedUpdatedAt?, nextFollowUp?: { type, dueAt, notes? } }
// The next follow-up is created on the same record, for the same person.
export async function completeTask(client, context, taskId, input = {}) {
  requireTaskPermission(context, TASK_PERMISSIONS.complete, "You do not have permission to complete tasks.");
  const row = await lockTask(client, context, taskId);
  if (row.status === "completed") return { changed: false, followUpId: null };
  if (row.status === "cancelled") throw new CrmError(409, "This task was cancelled. Reopen it before completing it.", "CRM_TASK_CLOSED");
  assertNotStale(row, input.expectedUpdatedAt);
  const note = text(input.note).slice(0, 1000) || null;
  const next = input.nextFollowUp;
  if (next && (!next.dueAt || Number.isNaN(new Date(next.dueAt).getTime())))
    throw new CrmError(400, "Choose when to follow up.", "CRM_TASK_VALIDATION", { issues: [{ field: "nextFollowUp.dueAt", message: "Choose when to follow up." }] });
  if (next && !row.entity_id) throw new CrmError(409, "A follow-up is about a lead, account, contact or opportunity. This task is not linked to one.", "CRM_TASK_VALIDATION");

  await client.query(
    `UPDATE tenant.crm_activities SET status = 'completed', completed_at = now(), completed_by = $3, outcome = COALESCE($4, outcome), updated_by = $3
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, context.userId ?? null, note],
  );
  await cancelPendingRemindersForActivity(client, context, row.id);
  await touchRelated(client, context, row);
  await recordTaskHistory(client, context, row.id, "completed", note ? `Completed — ${note}` : "Completed", { note });
  const task = await getTask(client, context, row.id).catch(() => null);
  if (task) await notifyTaskCompleted(client, context, task);
  let followUpId = null;
  if (next) {
    const channel = FOLLOW_UP_CHANNELS.has(text(next.type).toLowerCase()) ? text(next.type).toLowerCase() : "call";
    const followUp = await createCrmFollowUp(client, context, {
      entityType: row.entity_type, entityId: row.entity_id, subject: `Follow up: ${row.subject}`.slice(0, 300), description: text(next.notes) || null,
      assignedTo: row.assigned_to ?? context.userId, dueAt: new Date(next.dueAt).toISOString(), followUpChannel: channel,
    });
    followUpId = followUp.id;
  }
  await queueOutboxEvent(client, context, "crm.task.completed", "tasks", row.id, { followUpId });
  return { changed: true, followUpId };
}

// ------------------------------------------------------------------ reopen, cancel

// A completed or cancelled task back to open. Its earlier completion or
// cancellation stays in the history.
export async function reopenTask(client, context, taskId, input = {}) {
  requireTaskPermission(context, TASK_PERMISSIONS.reopen, "You do not have permission to reopen tasks.");
  const row = await lockTask(client, context, taskId);
  if (isOpenRow(row)) return { changed: false };
  assertNotStale(row, input.expectedUpdatedAt);
  await client.query(
    `UPDATE tenant.crm_activities SET status = 'planned', completed_at = NULL, completed_by = NULL, cancelled_at = NULL, cancelled_by = NULL,
            cancellation_reason = NULL, overdue_notified_at = NULL, updated_by = $3
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, context.userId ?? null],
  );
  await scheduleTaskReminder(client, context, row.id, row.due_at, row.reminder_offset_minutes);
  const reason = text(input.reason).slice(0, 500) || null;
  await recordTaskHistory(client, context, row.id, "reopened", `Reopened${reason ? ` — ${reason}` : ""}`, {
    from: row.status, reason, previousCompletedAt: row.completed_at, previousCancellationReason: row.cancellation_reason,
  });
  return { changed: true };
}

// input: { reason?, expectedUpdatedAt? }. Cancelled is kept, not deleted.
export async function cancelTask(client, context, taskId, input = {}) {
  requireTaskPermission(context, TASK_PERMISSIONS.cancel, "You do not have permission to cancel tasks.");
  const row = await lockTask(client, context, taskId);
  if (row.status === "cancelled") return { changed: false };
  if (row.status === "completed") throw new CrmError(409, "This task is completed. Reopen it before cancelling it.", "CRM_TASK_CLOSED");
  assertNotStale(row, input.expectedUpdatedAt);
  const reason = text(input.reason).slice(0, 500) || null;
  await client.query(
    `UPDATE tenant.crm_activities SET status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancellation_reason = $4, updated_by = $3
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, context.userId ?? null, reason],
  );
  await cancelPendingRemindersForActivity(client, context, row.id);
  await recordTaskHistory(client, context, row.id, "cancelled", `Cancelled${reason ? ` — ${reason}` : ""}`, { reason });
  return { changed: true };
}

export async function listTaskHistory(client, context, taskId) {
  const task = await getTask(client, context, taskId);
  return listTaskHistoryEntries(client, context, task.id);
}

// ------------------------------------------------------------------ bulk

// Runs one operation per task; each succeeds or fails on its own.
async function runBulk(client, taskIds, operation) {
  const ids = [...new Set(Array.isArray(taskIds) ? taskIds : [])];
  if (!ids.length) throw new CrmError(400, "Select at least one task.", "CRM_TASK_VALIDATION");
  if (ids.length > 200) throw new CrmError(400, "Select up to 200 tasks at a time.", "CRM_TASK_BULK_LIMIT");
  const results = [];
  for (const taskId of ids) {
    await client.query("SAVEPOINT task_bulk_operation");
    try {
      const outcome = await operation(taskId);
      await client.query("RELEASE SAVEPOINT task_bulk_operation");
      results.push({ taskId, ok: true, changed: outcome?.changed !== false });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT task_bulk_operation");
      if (!(error instanceof CrmError)) throw error;
      results.push({ taskId, ok: false, message: error.message });
    }
  }
  return { results, succeeded: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok).length };
}

// input: { taskIds, action: assign | priority | reschedule | complete | cancel, assignedTo?, priority?, dueDate?, shiftDays?, reason? }
export async function bulkUpdateTasks(client, context, input = {}) {
  const { updateTask } = await import("./records.js");
  const action = text(input.action);
  if (action === "assign") return runBulk(client, input.taskIds, (id) => assignTask(client, context, id, { assignedTo: input.assignedTo, reason: input.reason }));
  if (action === "priority") return runBulk(client, input.taskIds, (id) => updateTask(client, context, id, { priority: input.priority }));
  if (action === "complete") return runBulk(client, input.taskIds, (id) => completeTask(client, context, id, {}));
  if (action === "cancel") return runBulk(client, input.taskIds, (id) => cancelTask(client, context, id, { reason: input.reason }));
  if (action === "reschedule") {
    const shift = Math.trunc(Number(input.shiftDays));
    if (!input.dueDate && (!Number.isFinite(shift) || shift === 0)) throw new CrmError(400, "Choose a new due date, or how many days to move the tasks.", "CRM_TASK_VALIDATION");
    return runBulk(client, input.taskIds, async (id) => {
      const task = await getTask(client, context, id);
      const dueDate = input.dueDate || new Date(Date.parse(`${task.dueDate}T00:00:00Z`) + shift * 86400000).toISOString().slice(0, 10);
      return updateTask(client, context, id, { dueDate, dueTime: task.dueTime ?? "" });
    });
  }
  throw new CrmError(400, "Choose what to do with the selected tasks.", "CRM_TASK_VALIDATION");
}

export const bulkAssignTasks = (client, context, input = {}) => bulkUpdateTasks(client, context, { ...input, action: "assign" });

// The open tasks on a record that is being closed (an opportunity won or
// lost): kept as they are, or cancelled with the reason given.
export async function settleOpenTasks(client, context, entityType, entityId, { action = "keep", reason = null } = {}) {
  if (action !== "cancel") return { cancelled: 0 };
  const { rows } = await client.query(
    `SELECT id FROM tenant.crm_activities WHERE organization_id = $1 AND activity_type = 'task' AND entity_type = $2 AND entity_id = $3
        AND status IN ('planned', 'in_progress', 'overdue') FOR UPDATE`,
    [context.organizationId, entityType, entityId],
  );
  for (const row of rows) {
    await client.query(
      `UPDATE tenant.crm_activities SET status = 'cancelled', cancelled_at = now(), cancelled_by = $3, cancellation_reason = $4, updated_by = $3 WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, row.id, context.userId ?? null, reason],
    );
    await cancelPendingRemindersForActivity(client, context, row.id);
    await recordTaskHistory(client, context, row.id, "cancelled", `Cancelled — ${reason}`, { reason });
  }
  return { cancelled: rows.length };
}
