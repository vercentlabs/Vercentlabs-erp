import { getCrmCommunicationsReadiness } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmCommunicationsErrorResponse } from "@/modules/crm/seller-activity-and-follow-up-workspace/communications";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmReportsView);
    const context = await crmApiContext(session);
    const readiness = await tenantTransaction(
      context.organizationId,
      (client) => getCrmCommunicationsReadiness(client, context),
    );
    return ok({ readiness });
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
