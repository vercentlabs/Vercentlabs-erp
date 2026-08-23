import { getLeadAcquisitionDashboard } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmLeadAcquisitionErrorResponse } from "@/modules/crm/server/lead-acquisition";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const dashboard = await tenantTransaction(
      context.organizationId,
      (client) => getLeadAcquisitionDashboard(client, context),
    );
    return ok({ dashboard });
  } catch (error) {
    return crmLeadAcquisitionErrorResponse(error);
  }
}
