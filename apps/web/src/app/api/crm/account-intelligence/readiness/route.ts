import { getCrmAccountIntelligenceReadiness } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmApiContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { crmAccountIntelligenceErrorResponse } from "@/lib/crm-account-intelligence-route";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmReportsView);
    const context = await crmApiContext(session);
    const readiness = await tenantTransaction(
      context.organizationId,
      (client) => getCrmAccountIntelligenceReadiness(client, context),
    );
    return ok({ readiness });
  } catch (error) {
    return crmAccountIntelligenceErrorResponse(error);
  }
}
