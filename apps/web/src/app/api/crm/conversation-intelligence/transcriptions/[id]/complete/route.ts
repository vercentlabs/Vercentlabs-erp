import { completeConversationTranscription } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmApiContext } from "@/lib/crm";
import { crmConversationIntelligenceErrorResponse } from "@/lib/crm-conversation-intelligence-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmAiManage);
    const context = await crmApiContext(session);
    const { id } = await route.params;
    const input = (await request.json()) as Record<string, unknown>;
    const transcript = await tenantTransaction(
      context.organizationId,
      (client) => completeConversationTranscription(client, context, id, input),
    );
    return ok({ transcript });
  } catch (error) {
    return crmConversationIntelligenceErrorResponse(error);
  }
}
