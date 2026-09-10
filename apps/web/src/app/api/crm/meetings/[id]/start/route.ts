import { getCrmMeeting, startCrmMeeting } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmMeetingAuditSnapshot } from "@/modules/crm/crm-data-operations-and-customization/audit-events";
import { meetingLifecycleSchema } from "@/modules/crm/crm-data-operations-and-customization/input-validation";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id } = await route.params; assertCrmIdentifier(id);
    const input = meetingLifecycleSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const before = await getCrmMeeting(client, context, id);
      const started = await startCrmMeeting(client, context, id, input);
      if (!started.replayed) await audit({ organizationId: context.organizationId, actorUserId: context.userId, eventType: "crm.meeting.started", entityType: "meeting", entityId: id, beforeData: crmMeetingAuditSnapshot(before), afterData: crmMeetingAuditSnapshot(started), request, client });
      return started;
    });
    return ok({ message: record.replayed ? "Meeting is already in progress." : "Meeting started.", record });
  } catch (error) { return crmErrorResponse(error); }
}
