import { previewPrivacyRequest } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { crmAccountIntelligenceErrorResponse } from "@/lib/crm-account-intelligence-route";

export async function GET(
  _request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmPrivacyManage);
    const { id } = await route.params;
    const context = crmContext(session);
    const preview = await tenantTransaction(context.organizationId, (client) =>
      previewPrivacyRequest(client, context, id),
    );
    return ok({ preview });
  } catch (error) {
    return crmAccountIntelligenceErrorResponse(error);
  }
}
