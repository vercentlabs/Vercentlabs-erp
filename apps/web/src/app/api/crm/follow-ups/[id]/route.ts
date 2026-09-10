import { getCrmFollowUp, listRemindersForActivity, updateCrmFollowUp } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/api";
import { crmFollowUpAuditSnapshot } from "@/modules/crm/audit";
import { updateFollowUpSchema } from "@/modules/crm/validation";

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
      record: await getCrmFollowUp(client, context, id),
      reminders: await listRemindersForActivity(client, context, id),
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
    const input = updateFollowUpSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const before = await getCrmFollowUp(client, context, id);
      const updated = await updateCrmFollowUp(client, context, id, input);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "crm.follow_up.updated",
        entityType: "follow_up",
        entityId: id,
        beforeData: crmFollowUpAuditSnapshot(before),
        afterData: crmFollowUpAuditSnapshot(updated),
        request,
        client,
      });
      return updated;
    });
    return ok({ message: "Follow-up updated.", record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
