import { getLeadIntelligenceDashboard } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmLeadIntelligenceErrorResponse } from "@/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-intelligence";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";
export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive);
    const context = await crmApiContext(session);
    const dashboard = await tenantTransaction(
      context.organizationId,
      (client) => getLeadIntelligenceDashboard(client, context),
    );
    return ok({ dashboard });
  } catch (error) {
    return crmLeadIntelligenceErrorResponse(error);
  }
}
