import { getAccountHierarchy, setAccountParent } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import {
  requireBillingWriteAccess,
  incrementBillingUsage,
} from "@/core/billing";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { crmAccountIntelligenceErrorResponse } from "@/modules/crm/prospect-and-relationship-master-data/account-intelligence";
import { assertSameOriginOrMobile, audit } from "@/core/security";

export async function GET(
  _request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const { id } = await route.params;
    const context = await crmApiContext(session);
    const hierarchy = await tenantTransaction(
      context.organizationId,
      (client) => getAccountHierarchy(client, context, id),
    );
    return ok({ hierarchy });
  } catch (error) {
    return crmAccountIntelligenceErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmAccountsManage);
    const body = (await readJson(request)) as {
      parentPartyId?: string | null;
      reason?: string;
    };
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { id } = await route.params;
    const context = await crmApiContext(session);
    const result = await tenantTransaction(
      context.organizationId,
      async (client) => {
        const updated = await setAccountParent(
          client,
          context,
          id,
          body.parentPartyId || null,
          body.reason || null,
        );
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.account.parent.changed",
          entityType: "account",
          entityId: id,
          afterData: updated,
          request,
          client,
        });
        return updated;
      },
    );
    return ok({ message: "Account hierarchy updated.", account: result });
  } catch (error) {
    return crmAccountIntelligenceErrorResponse(error);
  }
}
