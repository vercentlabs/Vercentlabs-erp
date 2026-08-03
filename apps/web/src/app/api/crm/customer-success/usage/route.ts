import { ingestProductUsageEvent } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import {
  requireBillingWriteAccess,
  incrementBillingUsage,
} from "@/lib/billing";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok, readJson } from "@/lib/http";
import { crmCustomerSuccessErrorResponse } from "@/lib/crm-customer-success-route";
import { assertSameOriginOrMobile, audit } from "@/lib/security";

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmIntegrationsManage);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const body = (await readJson(request)) as Record<string, unknown>;
    const context = crmContext(session);
    const event = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const value = await ingestProductUsageEvent(client, context, body);
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.customer_success.usage_ingested",
          entityType: "account",
          entityId: String(body.partyId || ""),
          afterData: value,
          request,
          client,
        });
        return value;
      },
    );
    return ok({ event });
  } catch (error) {
    return crmCustomerSuccessErrorResponse(error);
  }
}
