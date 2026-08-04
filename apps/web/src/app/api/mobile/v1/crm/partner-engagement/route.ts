import { getPartnerEngagementDashboard } from "@vercentlabs/api";
import { requireMobileSession } from "@/lib/mobile-session";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = crmContext(session);
    return mobileOk(request, {
      dashboard: await tenantTransaction(context.organizationId, (client) =>
        getPartnerEngagementDashboard(client, context),
      ),
    });
  } catch (error) {
    return mobileError(request, error);
  }
}
