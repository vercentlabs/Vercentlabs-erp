import { previewPrivacyRequest } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";
import { crmAccountIntelligenceErrorResponse } from "@/modules/crm/prospect-and-relationship-master-data/account-intelligence";

export async function GET(
  _request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmPrivacyManage);
    const { id } = await route.params;
    const context = await crmApiContext(session);
    const preview = await tenantTransaction(context.organizationId, (client) =>
      previewPrivacyRequest(client, context, id),
    );
    return ok({ preview });
  } catch (error) {
    return crmAccountIntelligenceErrorResponse(error);
  }
}
