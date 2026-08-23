import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/core/billing";
import { completeCrmActivity } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { assertCrmIdentifier } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { completeActivitySchema } from "@/modules/crm/validation";
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
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const input = completeActivitySchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const completed = await completeCrmActivity(
          client,
          context,
          id,
          input.outcome,
          {
            expectedUpdatedAt: input.expectedUpdatedAt,
            expectedStatus: input.expectedStatus,
          },
        );
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.activity.completed",
          entityType: "activity",
          entityId: id,
          afterData: completed,
          request,
          client,
        });
        return completed;
      },
    );
    return ok({ message: "Activity completed.", record });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
