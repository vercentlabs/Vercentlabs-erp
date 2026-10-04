// The few moments a task is worth a notification: it was given to you, and a
// task you asked someone else to do was completed. Reminders and the overdue
// notice come from the worker. Ordinary edits notify nobody.
import { createNotification } from "../../../core/platform/notifications/index.js";

export async function notifyTaskAssigned(client, context, task, { reassigned }) {
  if (!task.assignedTo || task.assignedTo === context.userId) return;
  await createNotification(client, {
    organizationId: context.organizationId,
    userId: task.assignedTo,
    category: "crm_task_assignment",
    title: reassigned ? "Task reassigned to you" : "Task assigned to you",
    message: `${task.title}${task.dueDate ? ` · due ${task.dueDate}${task.dueTime ? ` ${task.dueTime}` : ""}` : ""}${task.relatedName ? ` · ${task.relatedName}` : ""}`,
    href: `/crm/tasks/${task.id}`,
    entityType: "crm_activity",
    entityId: task.id,
  });
}

export async function notifyTaskCompleted(client, context, task) {
  if (!task.createdBy || task.createdBy === context.userId || task.createdBy === task.assignedTo) return;
  await createNotification(client, {
    organizationId: context.organizationId,
    userId: task.createdBy,
    category: "crm_task_completed",
    title: "A task you created was completed",
    message: `${task.title}${task.completedByName ? ` · by ${task.completedByName}` : ""}`,
    href: `/crm/tasks/${task.id}`,
    entityType: "crm_activity",
    entityId: task.id,
  });
}
