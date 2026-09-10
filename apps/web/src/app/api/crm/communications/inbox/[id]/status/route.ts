import { updateSharedInboxThreadStatus } from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { assertSameOrigin, audit } from "@/core/security";
import { crmApiContext } from "@/modules/crm";
import { crmCommunicationsErrorResponse } from "@/modules/crm/server/communications";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";

// F018 closeout (§33) — honest thread status (open/pending/closed/spam/
// archived), a plain governed field update, not a support-ticket state
// machine.
export async function POST(
  request: Request,
  route: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmCommunicationsManage);
    const context = await crmApiContext(session);
    const { id } = await route.params;
    const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const thread = await tenantTransaction(context.organizationId, async (client) => {
      const updated = await updateSharedInboxThreadStatus(client, context, id, input.status);
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.inbox.thread_status_changed",
        entityType: "email_thread",
        entityId: id,
        afterData: { status: updated.status },
        request,
        client,
      });
      return updated;
    });
    return ok({ thread });
  } catch (error) {
    return crmCommunicationsErrorResponse(error);
  }
}
