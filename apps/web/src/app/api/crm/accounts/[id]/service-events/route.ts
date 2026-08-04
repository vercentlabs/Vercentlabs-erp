import { recordCustomerServiceEvent } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import {
  requireBillingWriteAccess,
  incrementBillingUsage,
} from "@/lib/billing";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok, readJson } from "@/lib/http";
import { crmAccountIntelligenceErrorResponse } from "@/lib/crm-account-intelligence-route";
import { assertSameOriginOrMobile, audit } from "@/lib/security";

export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmCommunicationsManage);
    const body = (await readJson(request)) as Record<string, unknown>;
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { id } = await route.params;
    const context = crmContext(session);
    const event = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const created = await recordCustomerServiceEvent(
          client,
          context,
          id,
          body,
        );
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.customer.service_event.recorded",
          entityType: "account",
          entityId: id,
          afterData: created,
          request,
          client,
        });
        return created;
      },
    );
    return ok({ message: "Customer service event recorded.", event });
  } catch (error) {
    return crmAccountIntelligenceErrorResponse(error);
  }
}
