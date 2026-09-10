import {
  createProviderOAuthState,
  consumeProviderOAuthState,
} from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmCommunicationsErrorResponse } from "@/modules/crm/seller-activity-and-follow-up-workspace/communications";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

export async function POST(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmIntegrationsManage);
    const context = await crmApiContext(session);
    const input = (await request.json()) as Record<string, unknown>;
    const result = await tenantTransaction(context.organizationId, (client) =>
      input.action === "consume"
        ? consumeProviderOAuthState(client, context, input)
        : createProviderOAuthState(client, context, input),
    );
    return ok({ result }, input.action === "consume" ? 200 : 201);
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
