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
  for (const task of lateTasks.rows) {
    if (task.assigned_to)
      await createNotification(client, {
        organizationId: context.organizationId,
        userId: task.assigned_to,
        category: "crm_task_overdue",
        title: "Task overdue",
        message: `${task.task_number ? `${task.task_number} · ` : ""}${task.subject} was due ${new Date(task.due_at).toLocaleString()}.`,
        href: `/crm/tasks/${task.id}`,
        entityType: "crm_activity",
        entityId: task.id,
      });
  }
  return { notified: lateTasks.rows.length };
}
