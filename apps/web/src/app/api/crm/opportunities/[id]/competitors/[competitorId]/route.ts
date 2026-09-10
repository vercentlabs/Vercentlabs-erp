import { removeOpportunityCompetitor } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/api";

type Route = { params: Promise<{ id: string; competitorId: string }> };

export async function DELETE(request: Request, route: Route) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmOpportunitiesManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id, competitorId } = await route.params;
    assertCrmIdentifier(id);
    assertCrmIdentifier(competitorId);
    const context = await crmApiContext(session);
    await tenantTransaction(context.organizationId, async (client) => {
      await removeOpportunityCompetitor(client, context, id, competitorId);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "crm.opportunity_competitor.removed",
        entityType: "opportunity",
        entityId: id,
        beforeData: { competitorId },
        request,
        client,
      });
    });
    return ok({ message: "Competitor removed." });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
