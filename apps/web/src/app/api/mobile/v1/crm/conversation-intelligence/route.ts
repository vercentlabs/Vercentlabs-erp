import { getConversationIntelligenceDashboard } from "@vercentlabs/api";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import { requireMobileSession } from "@/lib/mobile-session";
export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = crmContext(session);
    const dashboard = await tenantTransaction(
      context.organizationId,
      (client) => getConversationIntelligenceDashboard(client, context),
    );
    return mobileOk(request, {
      dashboard,
      contractVersion: "crm-conversation-intelligence-v1",
    });
  } catch (error) {
    return mobileError(request, error);
  }
}
