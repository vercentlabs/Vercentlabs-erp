import { receiveLeadConnectorWebhook, resolveLeadConnectorWebhook, verifyLeadConnectorSubscription } from "@vercentlabs/api/crm";
import { readRequestBytes, requireBillingWriteAccess } from "@vercentlabs/api";

import { ingressTransaction, tenantTransaction } from "@/core/db";

// Public webhook for lead connectors (JustDial, IndiaMART push, Meta lead ads, Google Ads lead forms). Not a session route: the opaque
// key in the address is the credential (it resolves the connector and its organization server-side), and Meta's signature or
// Google's key is checked against the connector's own credentials. Errors reveal nothing beyond a stable code.
type Params = { params: Promise<{ key: string }> };

function failure(error: unknown) {
  const shaped = error as { status?: number; code?: string };
  const status = typeof shaped?.status === "number" && shaped.status >= 400 && shaped.status < 500 ? shaped.status : 500;
  if (status === 500) console.error("lead_connector_webhook_failed", { code: shaped?.code ?? "UNKNOWN" });
  return Response.json({ ok: false, code: status === 500 ? "LEAD_CONNECTOR_FAILED" : shaped.code }, { status, headers: { "Cache-Control": "no-store" } });
}

// JSON, form fields, or (a bodiless GET) the query string.
function parseBody(rawBody: string, contentType: string, query: URLSearchParams): unknown {
  if (!rawBody.trim()) return Object.fromEntries(query.entries());
  if (contentType.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(rawBody).entries());
  try {
    return JSON.parse(rawBody);
  } catch {
    return Object.fromEntries(new URLSearchParams(rawBody).entries());
  }
}

async function receive(request: Request, key: string) {
  const rawBody = new TextDecoder().decode(await readRequestBytes(request, 1024 * 1024));
  const row = await ingressTransaction((client) => resolveLeadConnectorWebhook(client, key));
  const url = new URL(request.url);
  const result = await receiveLeadConnectorWebhook(
    {
      runTenant: (work) => tenantTransaction(row.organization_id, async (client) => {
        await requireBillingWriteAccess(client, row.organization_id, process.env);
        return work(client);
      }),
    },
    row,
    { rawBody, headers: request.headers, body: parseBody(rawBody, request.headers.get("content-type") ?? "", url.searchParams) },
  );
  return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}

// Meta's subscription check echoes hub.challenge; JustDial may also send a lead as a GET with its fields in the query.
export async function GET(request: Request, { params }: Params) {
  const { key } = await params;
  try {
    const url = new URL(request.url);
    if (url.searchParams.has("hub.mode")) {
      const row = await ingressTransaction((client) => resolveLeadConnectorWebhook(client, key));
      const challenge = await verifyLeadConnectorSubscription(row, url.searchParams);
      if (challenge === null) return Response.json({ ok: false, code: "CRM_CONNECTOR_VERIFY_TOKEN" }, { status: 403 });
      return new Response(challenge, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    }
    return await receive(request, key);
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  const { key } = await params;
  try {
    return await receive(request, key);
  } catch (error) {
    return failure(error);
  }
}
