import { getCommunicationsDashboard } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { crmCommunicationsErrorResponse } from "@/lib/crm-communications-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = crmContext(session);
    const dashboard = await tenantTransaction(
      context.organizationId,
      (client) => getCommunicationsDashboard(client, context),
    );
    return ok({ dashboard, contractVersion: "crm-communications-v1" });
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
