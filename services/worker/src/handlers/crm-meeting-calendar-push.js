import { z } from "zod";
import {
  prepareMeetingCalendarPush,
  pushProviderCalendarEvent,
  recordMeetingCalendarPushResult,
} from "@vercentlabs/api";

export const JOB_TYPE = "crm.meetings.calendar_push";

export const payloadSchema = z
  .object({
    activityId: z.string().uuid(),
    action: z.enum(["create", "update", "cancel"]),
  })
  .strict();

// F014 closeout: pushes ONE Meeting (create/update/cancel) to its host's
// connected Gmail/Microsoft365 calendar — the outbound counterpart to the
// pre-existing inbound-only fetchProviderCalendarDelta sync. Triggered
// per-event by meeting-operations.js/bookMeeting (see their own
// enqueueCalendarPushJob calls), never a scheduled scan — most
// organizations will have zero connected accounts most of the time, so a
// scan would be almost entirely wasted work.
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
// resolving what to push is one short read, the real provider HTTP call
// must never happen while holding that transaction/lock open (see
// pushProviderCalendarEvent's own comment), and persisting the result is a
// second short write — exactly the same shape as
// crm-follow-up-reminder-dispatch.js's claim/deliver/mark-outcome split.
export async function pushMeetingCalendarEventHandler(_client, _systemContext, payload, runtime) {
  const context = systemContext(runtime.organizationId);
  const prepared = await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
    prepareMeetingCalendarPush(client, context, payload.activityId),
  );
  // No connected outbound-capable calendar account for this Meeting's host
  // is a legitimate, silent no-op — most Meetings will never have one.
  if (!prepared) return { pushed: false, reason: "NO_CONNECTED_ACCOUNT" };

  const result = await pushProviderCalendarEvent(prepared.account, prepared.event, payload.action);

  await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) =>
    recordMeetingCalendarPushResult(client, context, prepared.calendarEventId, prepared.account.provider, result),
  );
  return { pushed: true, action: payload.action, externalEventId: result.externalEventId };
}
