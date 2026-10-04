// A follow-up is worth a notification when it is given to you. Reminders come
// from the worker at the time the assignee chose. Overdue follow-ups are shown
// in the lists and on the dashboard, not announced again and again.
import { createNotification } from "../../../core/platform/notifications/index.js";

export async function notifyFollowUpAssigned(client, context, followUp, { reassigned }) {
  if (!followUp.assignedTo || followUp.assignedTo === context.userId) return;
  await createNotification(client, {
    organizationId: context.organizationId,
    userId: followUp.assignedTo,
    category: "crm_follow_up_assignment",
    title: reassigned ? "Follow-up reassigned to you" : "Follow-up assigned to you",
    message: [followUp.subject, followUp.contactName, followUp.accountName, `${followUp.scheduledDate}${followUp.scheduledTime ? ` ${followUp.scheduledTime}` : ""}`].filter(Boolean).join(" · "),
    href: `/crm/follow-ups/${followUp.id}`,
    entityType: "crm_activity",
    entityId: followUp.id,
  });
}
