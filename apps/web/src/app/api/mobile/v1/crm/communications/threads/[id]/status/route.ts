import { updateSharedInboxThreadStatus } from "@vercentlabs/api";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";

// Mobile/API parity (F018 §9) — same updateSharedInboxThreadStatus,
// including the shared-inbox membership gate.
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request);
    const session = await requireMobileSession(request);
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
    return mobileOk(request, { thread });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
