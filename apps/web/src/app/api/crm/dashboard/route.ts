import { getCrmDashboard } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requireCrmView } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const context = await crmApiContext(session);
    const dashboard = await tenantTransaction(
      context.organizationId,
      (client) => getCrmDashboard(client, context),
    );
    return ok({ dashboard });
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
