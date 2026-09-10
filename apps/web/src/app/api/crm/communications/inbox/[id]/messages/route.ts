import { listThreadMessages } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { crmCommunicationsErrorResponse } from "@/modules/crm/seller-activity-and-follow-up-workspace/communications";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

// F018 closeout (§33) — the shared-inbox thread detail view: real messages
// for one thread, not the list-of-threads-only dashboard.
export async function GET(
  _request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmCommunicationsManage);
    const context = await crmApiContext(session);
    const { id } = await route.params;
    const result = await tenantTransaction(context.organizationId, (client) =>
      listThreadMessages(client, context, id),
    );
    return ok(result);
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
