import { claimSharedInboxThread } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmCommunicationsErrorResponse } from "@/modules/crm/seller-activity-and-follow-up-workspace/communications";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

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
