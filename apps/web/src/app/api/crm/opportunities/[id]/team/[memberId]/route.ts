import { removeOpportunityTeamMember } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/api";

type Route = { params: Promise<{ id: string; memberId: string }> };

export async function DELETE(request: Request, route: Route) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmOpportunitiesManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id, memberId } = await route.params;
    assertCrmIdentifier(id);
    assertCrmIdentifier(memberId);
    const context = await crmApiContext(session);
    await tenantTransaction(context.organizationId, async (client) => {
      await removeOpportunityTeamMember(client, context, id, memberId);
      await audit({
        organizationId: context.organizationId,
        actorUserId: context.userId,
        eventType: "crm.opportunity_team.member_removed",
        entityType: "opportunity",
        entityId: id,
        beforeData: { teamMemberId: memberId },
        request,
        client,
      });
    });
    return ok({ message: "Team member removed." });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
