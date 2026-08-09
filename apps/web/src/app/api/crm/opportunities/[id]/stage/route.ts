import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { moveOpportunityStage } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { assertCrmIdentifier } from "@/lib/crm-api";
import { crmApiContext, rethrowCrmError } from "@/lib/crm";
import { moveStageSchema } from "@/lib/crm-validation";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";
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
