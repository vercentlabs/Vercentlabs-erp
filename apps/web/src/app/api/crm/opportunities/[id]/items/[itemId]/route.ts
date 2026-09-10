import { updateOpportunityItem, removeOpportunityItem } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";

type Route = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(request: Request, route: Route) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmOpportunitiesManage);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { id, itemId } = await route.params;
    assertCrmIdentifier(id);
    assertCrmIdentifier(itemId);
    const input = (await readJson(request)) as Record<string, unknown>;
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const updated = await updateOpportunityItem(client, context, id, itemId, input);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "crm.opportunity_item.updated",
        entityType: "opportunity",
        entityId: id,
        afterData: { opportunityItemId: itemId },
        request,
        client,
      });
      return updated;
    });
    return ok({ message: "Product updated.", record });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function DELETE(request: Request, route: Route) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmOpportunitiesManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id, itemId } = await route.params;
    assertCrmIdentifier(id);
    assertCrmIdentifier(itemId);
    const context = await crmApiContext(session);
    await tenantTransaction(context.organizationId, async (client) => {
      await removeOpportunityItem(client, context, id, itemId);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "crm.opportunity_item.removed",
        entityType: "opportunity",
        entityId: id,
        beforeData: { opportunityItemId: itemId },
        request,
        client,
      });
    });
    return ok({ message: "Product removed." });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
