import { executePrivacyRequest } from "@vercentlabs/api";
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
    requirePermissionFromSession(session, PERMISSIONS.crmPrivacyManage);
    const body = (await readJson(request)) as Record<string, unknown>;
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { id } = await route.params;
    const context = await crmApiContext(session);
    const execution = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const result = await executePrivacyRequest(client, context, id, body);
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.privacy.executed",
          entityType: "privacy_request",
          entityId: id,
          afterData: { run: result.run },
          request,
          client,
        });
        return result;
      },
    );
    return ok({ message: "Privacy request executed.", ...execution });
  } catch (error) {
    return crmAccountIntelligenceErrorResponse(error);
  }
}
