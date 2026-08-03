import { startClickToCall } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { crmConversationIntelligenceErrorResponse } from "@/lib/crm-conversation-intelligence-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmCommunicationsManage);
    const context = crmContext(session);
    const input = (await request.json()) as Record<string, unknown>;
    const conversation = await tenantTransaction(
      context.organizationId,
      (client) => startClickToCall(client, context, input),
    );
    return ok({ conversation }, 201);
  } catch (error) {
    return crmConversationIntelligenceErrorResponse(error);
  }
}
