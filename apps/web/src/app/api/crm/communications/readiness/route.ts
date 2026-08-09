import { getCrmCommunicationsReadiness } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmApiContext } from "@/lib/crm";
import { crmCommunicationsErrorResponse } from "@/lib/crm-communications-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

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
