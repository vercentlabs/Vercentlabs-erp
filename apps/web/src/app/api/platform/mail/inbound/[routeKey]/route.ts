import { receiveInboundMail } from "@vercentlabs/api";

import { tenantTransaction, transaction } from "@/core/db";

// Public provider webhook for inbound email. Not a session route: it is
// authenticated by the opaque route key (resolves the organisation, target and
// company server-side) AND an HMAC of the exact raw body with that route's
// signing secret. Organisation ids in the body are ignored. Errors reveal
// nothing beyond a stable code.
export async function POST(request: Request, context: { params: Promise<{ routeKey: string }> }) {
  const { routeKey } = await context.params;
  try {
    const rawBody = await request.text();
    const result = await receiveInboundMail(
      { runPlatform: (work) => transaction(work), runTenant: (organizationId, work) => tenantTransaction(organizationId, work) },
      { routeKey, rawBody, signature: request.headers.get("x-inbound-signature") },
    );
    return Response.json({ ok: true, eventId: result.eventId, replayed: result.replayed, outcome: result.outcome ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const shaped = error as { status?: number; code?: string };
    const status = typeof shaped?.status === "number" && shaped.status >= 400 && shaped.status < 500 ? shaped.status : 500;
    if (status === 500) console.error("inbound_mail_failed", { code: shaped?.code ?? "UNKNOWN" });
    return Response.json({ ok: false, code: status === 500 ? "INBOUND_MAIL_FAILED" : shaped.code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
