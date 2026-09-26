import { z } from "zod";
import { addBusinessMinutes, claimDueNurtureQueueItems, createNotification, sendTransactionalEmail } from "@vercentlabs/api";

export const JOB_TYPE = "crm.nurture_queue.dispatch_notifications";

export const payloadSchema = z.object({}).strict();

// Same fixed business-hours default crm_lead_sla_policies/F016's Scheduled
// Follow-up reminders already use (see follow-up-operations.js's own
// comment on why a fixed default is proportionate here rather than a new
// per-organization configurable schedule).
const DEFAULT_BUSINESS_HOURS = { timezone: "Asia/Kolkata", weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };

// F016 §7 closeout — "no-activity rule" notifications must respect working
// hours like every other F016 delivery channel, not fire silently at 2am.
// addBusinessMinutes's own window-seeking logic (a nominal 1-minute add)
// is reused rather than re-derived: if the result is more than ~1 minute
// past `now`, the clock was outside the window and got pushed forward —
// this tick defers (the item stays due, notified_at unset) and the next
// scheduler tick inside the window claims it instead.
function isWithinBusinessHours(now) {
  const adjusted = addBusinessMinutes(now, 1, DEFAULT_BUSINESS_HOURS);
  return adjusted.getTime() - now.getTime() <= 60_000;
}

// CRM-VNEXT-052 closeout (nurture-queue half — the Scheduled Follow-ups
// half was already closed by crm-follow-up-reminder-dispatch.js). System
// context is permission-neutral/org-wide, matching every other scheduled
// scan — a due nurture item must notify its owner regardless of which
// company/branch happened to be active when it was generated.
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

// Managed transaction mode: claiming due items is one short transaction
// (claimDueNurtureQueueItems marks notified_at atomically under
// FOR UPDATE SKIP LOCKED); sending the in-app/email notification — real
// I/O for email — never happens while holding that lock open, the same
// separation crm-follow-up-reminder-dispatch.js already uses.
export async function dispatchNurtureQueueNotificationsHandler(_client, _systemContext, _payload, runtime) {
  const context = systemContext(runtime.organizationId);

  if (!isWithinBusinessHours(new Date())) return { claimed: 0, notified: 0, skipped: 0, deferred: true };

  const claimed = await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
    claimDueNurtureQueueItems(client, context, { limit: 200 }),
  );

  let notified = 0;
  let skipped = 0;
  for (const item of claimed) {
    const lead = item.lead;
    if (!lead?.owner_user_id) { skipped += 1; continue; }
    const message = `${lead.full_name || lead.company_name || "A Lead"} is due for ${item.recommended_action || "follow-up"}.`;
    await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
      createNotification(client, {
        organizationId: context.organizationId,
        userId: lead.owner_user_id,
        category: "crm_nurture_queue_due",
        entityType: "crm_lead",
        entityId: lead.id,
        title: "Lead nurture action due",
        message,
        href: `/follow-ups`,
      }),
    );
    if (lead.owner_email) {
      await sendTransactionalEmail({
        to: lead.owner_email,
        subject: "Lead nurture action due",
        heading: "Lead nurture action due",
        body: message,
        actionLabel: "Open your nurture queue",
        actionUrl: null,
      }).catch(() => undefined); // best-effort — in-app notification above is the primary channel
    }
    notified += 1;
  }

  return { claimed: claimed.length, notified, skipped };
}
