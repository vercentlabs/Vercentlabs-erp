import { z } from "zod";
import { createNotification } from "@vercentlabs/api";

export const JOB_TYPE = "crm.tasks.notify_overdue";

export const payloadSchema = z.object({}).strict();

// Tasks: overdue is calculated from the due date, never stored. The assignee is told once; overdue_notified_at is the marker, cleared when
// the task is rescheduled, reassigned or reopened. Rows are claimed with SKIP LOCKED and stamped in the same statement, so a re-run or an
// overlapping tick never notifies twice.
export async function notifyOverdueTasksHandler(client, context) {
  const lateTasks = await client.query(
    `UPDATE tenant.crm_activities SET overdue_notified_at = now()
      WHERE id IN (SELECT id FROM tenant.crm_activities
                    WHERE organization_id = $1 AND activity_type = 'task' AND status IN ('planned', 'in_progress', 'overdue')
                      AND due_at < now() AND overdue_notified_at IS NULL
                    ORDER BY due_at LIMIT 200 FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [context.organizationId],
  );
  const timezone = (await client.query(`SELECT timezone FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0]?.timezone || "UTC";
  // In the organization's time zone and Indian format; a task with only a date shows the date (never a time nobody set).
  const due = (task) => {
    const options = task.due_time_set === false ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" };
    try { return new Date(task.due_at).toLocaleString("en-IN", { ...options, timeZone: timezone }); } catch { return new Date(task.due_at).toISOString().slice(0, 10); }
  };
  for (const task of lateTasks.rows) {
    if (task.assigned_to)
      await createNotification(client, {
        organizationId: context.organizationId,
        userId: task.assigned_to,
        category: "crm_task_overdue",
        title: "Task overdue",
        message: `${task.task_number ? `${task.task_number} · ` : ""}${task.subject} was due ${due(task)}.`,
        href: `/crm/tasks/${task.id}`,
        entityType: "crm_activity",
        entityId: task.id,
      });
  }
  return { notified: lateTasks.rows.length };
}
