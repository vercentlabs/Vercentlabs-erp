import { getMarketingDashboard } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { crmMarketingErrorResponse } from "@/lib/crm-marketing-route";
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
      (client) => getMarketingDashboard(client, context),
    );
    return ok({ dashboard });
  } catch (error) {
    return crmMarketingErrorResponse(error);
  }
}
