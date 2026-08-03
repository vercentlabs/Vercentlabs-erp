import { getCustomer360 } from "@vercentlabs/api";
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
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const { id } = await route.params;
    const context = crmContext(session);
    const customer = await tenantTransaction(context.organizationId, (client) =>
      getCustomer360(client, context, id),
    );
    return ok({ customer });
  } catch (error) {
    return crmAccountIntelligenceErrorResponse(error);
  }
}
