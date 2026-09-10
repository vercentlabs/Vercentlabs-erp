import { cancelCrmFollowUp, getCrmFollowUp } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/api";
import { crmFollowUpAuditSnapshot } from "@/modules/crm/audit";
import { followUpLifecycleSchema } from "@/modules/crm/validation";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const input = followUpLifecycleSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const before = await getCrmFollowUp(client, context, id);
      const cancelled = await cancelCrmFollowUp(client, context, id, input);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "crm.follow_up.cancelled",
        entityType: "follow_up",
        entityId: id,
        beforeData: crmFollowUpAuditSnapshot(before),
        afterData: crmFollowUpAuditSnapshot(cancelled),
        request,
        client,
      });
      return cancelled;
    });
    return ok({ message: "Follow-up cancelled.", record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
