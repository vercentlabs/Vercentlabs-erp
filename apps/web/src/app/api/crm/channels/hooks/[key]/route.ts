import { receiveCallStatus, receiveSmsStatus, resolveChannelWebhook } from "@vercentlabs/api/crm";
import { readRequestBytes } from "@vercentlabs/api";

import { ingressTransaction, tenantTransaction } from "@/core/db";

// Public callbacks for calls (Exotel status callback) and SMS (delivery reports from Exotel or MSG91). The key in the address resolves
// the organization and whether it is the call or the SMS callback; the fields come as a form, JSON or the query string.
type Params = { params: Promise<{ key: string }> };

async function fieldsOf(request: Request): Promise<Record<string, string>> {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  if (request.method === "GET") return query;
  const raw = new TextDecoder().decode(await readRequestBytes(request, 256 * 1024));
  if (!raw.trim()) return query;
  try {
    const parsed = JSON.parse(raw);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    // MSG91 posts { data: [{ requestId, report: [{ status, desc }] }] }.
    const report = first?.data?.[0];
    if (report?.requestId) return { requestId: String(report.requestId), status: String(report.report?.[0]?.status ?? ""), desc: String(report.report?.[0]?.desc ?? "") };
    return Object.fromEntries(Object.entries(first ?? {}).map(([key, value]) => [key, String(value ?? "")]));
  } catch {
    return { ...query, ...Object.fromEntries(new URLSearchParams(raw).entries()) };
  }
}

async function receive(request: Request, key: string) {
  try {
    const fields = await fieldsOf(request);
    const hook = await ingressTransaction((client) => resolveChannelWebhook(client, key));
    const result = await tenantTransaction(hook.organizationId, (client) =>
      hook.channel === "call" ? receiveCallStatus(client, hook.organizationId, fields) : receiveSmsStatus(client, hook.organizationId, fields));
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const shaped = error as { status?: number; code?: string };
    const status = typeof shaped?.status === "number" && shaped.status >= 400 && shaped.status < 500 ? shaped.status : 500;
    if (status === 500) console.error("channel_webhook_failed", { code: shaped?.code ?? "UNKNOWN" });
    return Response.json({ ok: false, code: status === 500 ? "CHANNEL_WEBHOOK_FAILED" : shaped.code }, { status });
  }
}

export async function POST(request: Request, { params }: Params) {
  return receive(request, (await params).key);
}

export async function GET(request: Request, { params }: Params) {
  return receive(request, (await params).key);
}
