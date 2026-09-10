import { getCrmLeadAcquisitionReadiness } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmLeadAcquisitionErrorResponse } from "@/modules/crm/prospect-and-relationship-master-data/lead-acquisition";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const readiness = await tenantTransaction(
      context.organizationId,
      (client) => getCrmLeadAcquisitionReadiness(client, context),
    );
    return ok({ readiness });
  } catch (error) {
    return crmLeadAcquisitionErrorResponse(error);
  }
}
