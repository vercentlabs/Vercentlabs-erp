import { getCrmAccountIntelligenceReadiness } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";
import { crmAccountIntelligenceErrorResponse } from "@/modules/crm/prospect-and-relationship-master-data/account-intelligence";

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
