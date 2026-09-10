import { listThreadMessages } from "@vercentlabs/api";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";

// Mobile/API parity (F018 §9/§18) — same listThreadMessages domain
// function the web shared-inbox reply UI uses: shared-inbox membership
// enforced, per-message audience (team/private/participant) and content
// projection (full vs metadata-only) applied identically to a mobile
// caller — no raw crm_communications/crm_email_messages response.
export async function GET(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmCommunicationsManage);
    const context = await crmApiContext(session);
    const { id } = await route.params;
    const result = await tenantTransaction(context.organizationId, (client) =>
      listThreadMessages(client, context, id),
    );
    return mobileOk(request, result);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
