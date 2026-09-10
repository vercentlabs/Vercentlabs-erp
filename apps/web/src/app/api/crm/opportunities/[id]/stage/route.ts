import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { moveOpportunityStage } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { moveStageSchema } from "@/modules/crm/crm-data-operations-and-customization/input-validation";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";
export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmOpportunitiesManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const input = moveStageSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const moved = await moveOpportunityStage(
          client,
          context,
          id,
          input.stageId,
          input.note,
          {
            expectedUpdatedAt: input.expectedUpdatedAt,
            expectedStageId: input.expectedStageId,
            outcomeReasonId: input.outcomeReasonId,
            outcomeNotes: input.outcomeNotes,
          },
        );
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.opportunity.stage_changed",
          entityType: "opportunity",
          entityId: id,
          afterData: moved,
          request,
          client,
        });
        return moved;
      },
    );
    return ok({ message: "Opportunity stage updated.", record });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
