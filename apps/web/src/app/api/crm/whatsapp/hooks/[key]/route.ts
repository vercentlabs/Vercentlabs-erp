import { receiveWhatsAppWebhook, resolveWhatsAppWebhook, verifyWhatsAppSubscription } from "@vercentlabs/api/crm";
import { readRequestBytes, requireBillingWriteAccess } from "@vercentlabs/api";

import { ingressTransaction, tenantTransaction } from "@/core/db";

// Public webhook for the WhatsApp Business (Cloud) API: Meta's subscription check (GET) and the messages and receipts it sends (POST,
// signed with the app secret). The key in the address resolves the organization server-side. Errors reveal nothing beyond a code.
type Params = { params: Promise<{ key: string }> };

function failure(error: unknown) {
  const shaped = error as { status?: number; code?: string };
  const status = typeof shaped?.status === "number" && shaped.status >= 400 && shaped.status < 500 ? shaped.status : 500;
  if (status === 500) console.error("whatsapp_webhook_failed", { code: shaped?.code ?? "UNKNOWN" });
  return Response.json({ ok: false, code: status === 500 ? "WHATSAPP_WEBHOOK_FAILED" : shaped.code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request, { params }: Params) {
  const { key } = await params;
  try {
    const row = await ingressTransaction((client) => resolveWhatsAppWebhook(client, key));
    const challenge = await verifyWhatsAppSubscription(row, new URL(request.url).searchParams);
    if (challenge === null) return Response.json({ ok: false, code: "CRM_WHATSAPP_VERIFY_TOKEN" }, { status: 403 });
    return new Response(challenge, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { key } = await params;
  try {
    const rawBody = new TextDecoder().decode(await readRequestBytes(request, 1024 * 1024));
    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { body = {}; }
    const row = await ingressTransaction((client) => resolveWhatsAppWebhook(client, key));
    const result = await receiveWhatsAppWebhook({
      runTenant: (work) => tenantTransaction(row.organization_id, async (client) => {
        await requireBillingWriteAccess(client, row.organization_id, process.env);
        return work(client);
      }),
    }, row, { rawBody, headers: request.headers, body });
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
