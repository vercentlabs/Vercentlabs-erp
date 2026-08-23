import { recordCustomerServiceEvent } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import {
  requireBillingWriteAccess,
  incrementBillingUsage,
} from "@/core/billing";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { crmAccountIntelligenceErrorResponse } from "@/modules/crm/server/account-intelligence";
import { assertSameOriginOrMobile, audit } from "@/core/security";

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
    const context = await crmApiContext(session);
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
