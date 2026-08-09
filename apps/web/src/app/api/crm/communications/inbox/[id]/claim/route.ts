import { claimSharedInboxThread } from "@vercentlabs/api";
import { getSessionContext } from "@/lib/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/lib/authorization";
import { crmApiContext } from "@/lib/crm";
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
    requirePermissionFromSession(session, PERMISSIONS.crmCommunicationsManage);
    const context = await crmApiContext(session);
    const { id } = await route.params;
    const input = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const thread = await tenantTransaction(context.organizationId, (client) =>
      claimSharedInboxThread(client, context, id, input),
    );
    return ok({ thread });
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
