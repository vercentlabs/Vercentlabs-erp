import { claimSharedInboxThread } from "@vercentlabs/api";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { assertSameOriginOrMobile } from "@/core/security";

// Mobile/API parity (F018 §9) — same claimSharedInboxThread, including the
// shared-inbox membership gate (a mobile caller cannot claim another
// team's thread by guessing its id) and the real claim/collision check.
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request);
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmCommunicationsManage);
    const context = await crmApiContext(session);
    const { id } = await route.params;
    const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const thread = await tenantTransaction(context.organizationId, (client) =>
      claimSharedInboxThread(client, context, id, input),
    );
    return mobileOk(request, { thread });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
