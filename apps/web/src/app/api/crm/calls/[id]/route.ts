import { getCrmCall, listCrmCallEvents, updateCrmCall } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmCallAuditSnapshot } from "@/modules/crm/crm-data-operations-and-customization/audit-events";
import { updateCallSchema } from "@/modules/crm/crm-data-operations-and-customization/input-validation";

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
      record: await getCrmCall(client, context, id),
      events: await listCrmCallEvents(client, context, id, 50),
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
    const input = updateCallSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const before = await getCrmCall(client, context, id);
      const updated = await updateCrmCall(client, context, id, input);
      if (!updated.replayed)
        await audit({
          organizationId: context.organizationId,
          actorUserId: context.userId,
          eventType: "crm.call.updated",
          entityType: "call",
          entityId: id,
          beforeData: crmCallAuditSnapshot(before),
          afterData: crmCallAuditSnapshot(updated),
          request,
          client,
        });
      return updated;
    });
    return ok({ message: record.replayed ? "Call is already current." : "Call updated.", record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
