import { upsertSharedInboxMember } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { crmCommunicationsErrorResponse } from "@/lib/crm-communications-route";
import { tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";

export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmIntegrationsManage);
    const context = crmContext(session);
    const { id } = await route.params;
    const input = (await request.json()) as Record<string, unknown>;
    const member = await tenantTransaction(context.organizationId, (client) =>
      upsertSharedInboxMember(client, context, id, input),
    );
    return ok({ member }, 201);
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
