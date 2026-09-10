import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { updateOpportunityProbability } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { updateOpportunityProbabilitySchema } from "@/modules/crm/crm-data-operations-and-customization/input-validation";
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
    const input = updateOpportunityProbabilitySchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const updated = await updateOpportunityProbability(
        client,
        context,
        id,
        input.probability,
        input.note,
        {
          expectedUpdatedAt: input.expectedUpdatedAt,
          expectedProbability: input.expectedProbability,
        },
      );
      if (!updated.replayed) {
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.opportunity.probability_changed",
          entityType: "opportunity",
          entityId: id,
          afterData: {
            probability: updated.probability,
            expectedRevenue: updated.expectedRevenue,
          },
          request,
          client,
        });
      }
      return updated;
    });
    return ok({
      message: record.replayed ? "Probability is already up to date." : "Probability updated.",
      record,
    });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
