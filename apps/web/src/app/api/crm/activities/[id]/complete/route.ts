import {
  incrementBillingUsage,
  requireBillingWriteAccess,
} from "@/lib/billing";
import { completeCrmActivity } from "@vercent/api";
import { getSessionContext } from "@/lib/auth";
import { assertCrmIdentifier } from "@/lib/crm-api";
import { crmContext, rethrowCrmError } from "@/lib/crm";
import { completeActivitySchema } from "@/lib/crm-validation";
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
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const input = completeActivitySchema.parse(await readJson(request));
    const context = crmContext(session);
    const record = await tenantTransaction(context.organizationId, (client) =>
      completeCrmActivity(client, context, id, input.outcome),
    );
    await audit({
      organizationId: context.organizationId,
      actorUserId: session.userId,
      eventType: "crm.activity.completed",
      entityType: "activity",
      entityId: id,
      afterData: record,
      request,
    });
    return ok({ message: "Activity completed.", record });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
