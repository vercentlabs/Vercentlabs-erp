import {
  createTelephonyConnection,
  getConversationIntelligenceDashboard,
} from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmApiContext } from "@/lib/crm";
import { crmConversationIntelligenceErrorResponse } from "@/lib/crm-conversation-intelligence-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const dashboard = await tenantTransaction(
      context.organizationId,
      (client) => getConversationIntelligenceDashboard(client, context),
    );
    return ok({ connections: dashboard.connections });
  } catch (error) {
    return crmConversationIntelligenceErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmIntegrationsManage);
    const context = await crmApiContext(session);
    const input = (await request.json()) as Record<string, unknown>;
    const connection = await tenantTransaction(
      context.organizationId,
      (client) => createTelephonyConnection(client, context, input),
    );
    return ok({ connection }, 201);
  } catch (error) {
    return crmConversationIntelligenceErrorResponse(error);
  }
}
