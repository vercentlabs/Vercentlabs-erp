import { getCrmFollowUp, listCrmFollowUpHistory } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";

export async function GET(_request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const { id } = await route.params;
    assertCrmIdentifier(id);
    const context = await crmApiContext(session);
    const events = await tenantTransaction(context.organizationId, async (client) => {
      await getCrmFollowUp(client, context, id);
      return listCrmFollowUpHistory(client, context, id);
    });
    return ok({ events });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
