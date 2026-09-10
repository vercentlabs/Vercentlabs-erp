import { getCrmMeeting, listCrmMeetingEvents, updateCrmMeeting } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmMeetingAuditSnapshot } from "@/modules/crm/crm-data-operations-and-customization/audit-events";
import { updateMeetingSchema } from "@/modules/crm/crm-data-operations-and-customization/input-validation";

type Route = { params: Promise<{ id: string }> };

export async function GET(_request: Request, route: Route) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const context = await crmApiContext(session);
    const result = await tenantTransaction(context.organizationId, async (client) => ({
      record: await getCrmMeeting(client, context, id),
      events: await listCrmMeetingEvents(client, context, id, 50),
    }));
    return ok(result);
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function PATCH(request: Request, route: Route) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const input = updateMeetingSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const before = await getCrmMeeting(client, context, id);
      const updated = await updateCrmMeeting(client, context, id, input);
      if (!updated.replayed)
        await audit({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          eventType: "crm.meeting.updated",
          entityType: "meeting",
          entityId: id,
          beforeData: crmMeetingAuditSnapshot(before),
          afterData: crmMeetingAuditSnapshot(updated),
          request,
          client,
        });
      return updated;
    });
    return ok({ message: record.replayed ? "Meeting is already current." : "Meeting updated.", record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
