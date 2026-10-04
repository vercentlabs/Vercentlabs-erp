import { z } from "zod";
import {
  claimDueReminders,
  markReminderOutcome,
  resetStuckDispatchingReminders,
} from "@vercentlabs/api/crm";
import {
  createNotification,
  sendTransactionalEmail,
} from "@vercentlabs/api";

export const JOB_TYPE = "crm.follow_ups.dispatch_reminders";

export const payloadSchema = z.object({}).strict();

// The one reminder worker for CRM: follow-ups, tasks and meetings all keep
// their reminders in crm_activity_reminders (modules/crm/reminders).
// System context is permission-neutral/org-wide, matching every other
// scheduled scan in this file — a reminder must fire regardless of its own
// creator's record visibility.
const FOLLOW_UP_TYPES = { call: "Call", email: "Email", meeting: "Meeting", demo: "Demo", other: "Follow-up" };

// When, in the organization's time zone: "Mon 8 Oct, 3:00 pm", or the day alone when no time was set.
function when(activity) {
  if (!activity.dueAt) return "";
  const options = activity.dueTimeSet === false ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  try {
    return new Date(activity.dueAt).toLocaleString("en-IN", { ...options, timeZone: activity.timezone || "UTC" });
  } catch {
    return new Date(activity.dueAt).toISOString();
  }
}

// What the reminder says: who to contact, at which company, how, about what and when.
function reminderText(activity) {
  if (activity.activityType === "follow_up") {
    const who = [activity.personName, activity.companyName && activity.companyName !== activity.personName ? activity.companyName : null].filter(Boolean).join(", ") || activity.relatedName;
    return {
      title: `${FOLLOW_UP_TYPES[activity.followUpType] ?? "Follow-up"}${who ? ` ${who}` : ""}`,
      message: [activity.subject, when(activity), activity.followUpNumber].filter(Boolean).join(" · "),
    };
  }
  if (activity.activityType === "task")
    return { title: "Task reminder", message: [activity.subject, activity.relatedName, `due ${when(activity)}`].filter(Boolean).join(" · ") };
  return { title: "Reminder", message: [activity.subject, when(activity)].filter(Boolean).join(" · ") };
}

function systemContext(organizationId) {
  return Object.freeze({
    organizationId,
    userId: null,
    permissions: [],
    roleSlugs: ["system_worker"],
  });
}

// Managed transaction mode (not one tenant_transaction for the whole job):
// claiming reminders and marking their outcome are each a short, separate
// transaction, so sending an email — real network I/O — never happens while
// holding a `FOR UPDATE SKIP LOCKED` lock open. This is exactly why
// claimDueReminders() moves a row 'pending' -> 'dispatching' as its own
// atomic step, rather than leaving the row locked for the duration of
// delivery (see modules/crm/reminders).
export async function dispatchFollowUpRemindersHandler(_client, _systemContext, _payload, runtime) {
  const context = systemContext(runtime.organizationId);

  // Recovery: a reminder left 'dispatching' by a worker that crashed (or
  // was killed) between claim and outcome must return to 'pending' so a
  // later tick can retry it — never silently lost, never auto-resent by a
  // timer racing a still-in-flight attempt.
  const recovered = await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
    resetStuckDispatchingReminders(client, context, { olderThanMinutes: 15 }),
  );

  const claimed = await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
    claimDueReminders(client, context, { limit: 200 }),
  );

  let sent = 0;
  let failed = 0;
  for (const reminder of claimed) {
    const activity = reminder.activity;
    if (!activity || !activity.assignedTo) {
      await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
        markReminderOutcome(client, context, reminder.id, { status: "failed", failureReason: "NO_ASSIGNEE" }),
      );
      failed += 1;
      continue;
    }
    try {
      if (reminder.channel === "in_app") {
        // The notification row and the "sent" mark commit together: this
        // channel's only side effect is a database row, so making both one
        // transaction means a crash cannot leave a delivered alert behind a
        // reminder that is still 'dispatching' — which the recovery step
        // would otherwise re-deliver as a duplicate.
        await runtime.withTenantClient(runtime.pool, runtime.organizationId, async (client) => {
          await createNotification(client, {
            organizationId: context.organizationId,
            userId: activity.assignedTo,
            category: activity.activityType === "task" ? "crm_task_due" : "crm_follow_up_reminder",
            entityType: "crm_activity",
            entityId: activity.id,
            ...reminderText(activity),
            href: activity.activityType === "task" ? `/crm/tasks/${activity.id}` : `/crm/follow-ups/${activity.id}`,
          });
          await markReminderOutcome(client, context, reminder.id, { status: "sent" });
        });
        sent += 1;
      } else if (reminder.channel === "email") {
        if (!activity.assignedEmail) {
          await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
            markReminderOutcome(client, context, reminder.id, { status: "failed", failureReason: "NO_EMAIL_ADDRESS" }),
          );
          failed += 1;
          continue;
        }
        const outcome = await sendTransactionalEmail({
          to: activity.assignedEmail,
          subject: `Follow-up reminder: ${activity.subject || "Untitled"}`,
          heading: "Follow-up reminder",
          body: `${activity.subject || "A Follow-up"} is due ${new Date(activity.dueAt).toLocaleString()}.`,
          actionLabel: "Open Follow-up",
          actionUrl: null,
        });
        await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
          markReminderOutcome(
            client,
            context,
            reminder.id,
            outcome.sent ? { status: "sent" } : { status: "failed", failureReason: outcome.reason || "SEND_FAILED" },
          ),
        );
        if (outcome.sent) sent += 1;
        else failed += 1;
      } else {
        await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
          markReminderOutcome(client, context, reminder.id, { status: "failed", failureReason: "UNSUPPORTED_CHANNEL" }),
        );
        failed += 1;
      }
    } catch (error) {
      await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
        markReminderOutcome(client, context, reminder.id, { status: "failed", failureReason: String(error?.message || error).slice(0, 500) }),
      );
      failed += 1;
    }
  }


  return { recovered, claimed: claimed.length, sent, failed };
}
