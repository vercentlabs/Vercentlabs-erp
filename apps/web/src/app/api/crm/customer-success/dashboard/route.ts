import { getCustomerSuccessDashboard } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { crmCustomerSuccessErrorResponse } from "@/lib/crm-customer-success-route";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmReportsView);
    const context = crmContext(session);
    const dashboard = await tenantTransaction(
      context.organizationId,
      (client) => getCustomerSuccessDashboard(client, context),
    );
    return ok({ dashboard });
  } catch (error) {
    return crmCustomerSuccessErrorResponse(error);
  }
}
