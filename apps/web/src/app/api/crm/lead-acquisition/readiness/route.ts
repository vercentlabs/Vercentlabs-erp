import { getCrmLeadAcquisitionReadiness } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { crmLeadAcquisitionErrorResponse } from "@/lib/crm-lead-acquisition-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = crmContext(session);
    const readiness = await tenantTransaction(
      context.organizationId,
      (client) => getCrmLeadAcquisitionReadiness(client, context),
    );
    return ok({ readiness });
  } catch (error) {
    return crmLeadAcquisitionErrorResponse(error);
  }
}
