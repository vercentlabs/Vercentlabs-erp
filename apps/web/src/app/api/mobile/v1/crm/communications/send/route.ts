import { queueOutboundEmail } from "@vercentlabs/api";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { withMobileIdempotency } from "@/core/mobile-idempotency";
import { assertSameOriginOrMobile } from "@/core/security";

// Mobile/API parity (F018 §10/§18) — the SAME queueOutboundEmail every
// send path (record-360, shared inbox reply) already routes through: the
// do-not-contact/suppression/consent-withdrawal gate fires before any
// thread/communication/message row is written, identically for a mobile
// caller — no alternate send path that could bypass it.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmCommunicationsManage);
    const context = await crmApiContext(session);
    const input = (await request.json()) as Record<string, unknown>;
    const response = await tenantTransaction(context.organizationId, (client) =>
      withMobileIdempotency(client, session, request, input, async () => ({
        message: await queueOutboundEmail(client, context, input),
      })),
    );
    return mobileOk(request, response, 202);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
