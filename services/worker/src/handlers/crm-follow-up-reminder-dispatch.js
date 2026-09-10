import { z } from "zod";
import {
  claimDueReminders,
  createInAppNotification,
  escalateOverdueFollowUps,
  markReminderOutcome,
  resetStuckDispatchingReminders,
} from "@vercentlabs/api";
import { sendTransactionalEmail } from "../mailer.js";

export const JOB_TYPE = "crm.follow_ups.dispatch_reminders";

export const payloadSchema = z.object({}).strict();

// F016 — the reminder-delivery + escalation timer this feature previously
// had no worker for at all (see crm_activity_reminders, migration 101/102).
// System context is permission-neutral/org-wide, matching every other
// scheduled scan in this file — a reminder must fire regardless of which
// company/branch its own creator happened to have selected.
function systemContext(organizationId) {
  return Object.freeze({
    organizationId,
    userId: null,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
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
// delivery (see follow-up-operations.js's own comment on this).
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
        await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
          createInAppNotification(client, context, {
            userId: activity.assignedTo,
            type: "crm_follow_up_reminder",
            category: "crm_follow_up_reminder",
            title: "Follow-up reminder",
            message: `${activity.subject || "A Follow-up"} is due ${new Date(activity.dueAt).toLocaleString()}.`,
            href: `/crm/activities?activityType=follow_up&id=${activity.id}`,
          }),
        );
        await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
          markReminderOutcome(client, context, reminder.id, { status: "sent" }),
        );
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

  const escalated = await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
    escalateOverdueFollowUps(client, context),
  );

  return { recovered, claimed: claimed.length, sent, failed, escalated };
}
