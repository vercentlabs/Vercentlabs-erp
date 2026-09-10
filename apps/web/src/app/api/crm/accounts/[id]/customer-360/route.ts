import { getCustomer360 } from "@vercentlabs/api";
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
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const { id } = await route.params;
    const context = await crmApiContext(session);
    const customer = await tenantTransaction(context.organizationId, (client) =>
      getCustomer360(client, context, id),
    );
    return ok({ customer });
  } catch (error) {
    return crmAccountIntelligenceErrorResponse(error);
  }
}
