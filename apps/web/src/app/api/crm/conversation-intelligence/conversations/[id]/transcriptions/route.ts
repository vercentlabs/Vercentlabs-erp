import { requestConversationTranscription } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
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
    const context = crmContext(session);
    const { id } = await route.params;
    const input = (await request.json()) as Record<string, unknown>;
    const job = await tenantTransaction(context.organizationId, (client) =>
      requestConversationTranscription(client, context, id, input),
    );
    return ok({ job }, 202);
  } catch (error) {
    return crmConversationIntelligenceErrorResponse(error);
  }
}
