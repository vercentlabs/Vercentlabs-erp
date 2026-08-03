import { getConversationIntelligenceDashboard } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { crmConversationIntelligenceErrorResponse } from "@/lib/crm-conversation-intelligence-route";
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
      (client) => getConversationIntelligenceDashboard(client, context),
    );
    return ok({ dashboard });
  } catch (error) {
    return crmConversationIntelligenceErrorResponse(error);
  }
}
