import { getConversationIntelligenceTimeline } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmApiContext } from "@/lib/crm";
import { crmConversationIntelligenceErrorResponse } from "@/lib/crm-conversation-intelligence-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const url = new URL(request.url);
    const timeline = await tenantTransaction(context.organizationId, (client) =>
      getConversationIntelligenceTimeline(client, context, {
        conversationId: url.searchParams.get("conversationId") || undefined,
        limit: url.searchParams.get("limit") || undefined,
      }),
    );
    return ok({ timeline });
  } catch (error) {
    return crmConversationIntelligenceErrorResponse(error);
  }
}
