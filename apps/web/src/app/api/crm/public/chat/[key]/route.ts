import { getPublicChat, startChat } from "@vercentlabs/api/crm";
import { isAppOrigin, readRequestBytes } from "@vercentlabs/api";

import { ingressTransaction } from "@/core/db";

// Website chat (CRM plan 5.8): GET the chat's greeting; POST { name, email?, mobile?, message, pageUrl? } starts a conversation and
// answers its token (the visitor's browser keeps it).
type Params = { params: Promise<{ key: string }> };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const failure = (error: unknown) => {
  const shaped = error as { status?: number; message?: string; code?: string };
  const status = typeof shaped?.status === "number" && shaped.status >= 400 && shaped.status < 500 ? shaped.status : 500;
  return json({ error: { message: status === 500 ? "The chat is not available right now." : shaped.message, code: shaped.code } }, status);
};

export async function GET(_request: Request, { params }: Params) {
  try {
    const { key } = await params;
    return json({ chat: await ingressTransaction((client) => getPublicChat(client, key)) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { key } = await params;
    const body = JSON.parse(new TextDecoder().decode(await readRequestBytes(request, 16 * 1024)) || "{}");
    const origin = request.headers.get("origin");
    const selfOrigin = isAppOrigin(origin ?? "") ? origin : null;
    return json(await ingressTransaction((client) => startChat(client, key, body, { origin: request.headers.get("x-chat-page-origin") ?? origin, selfOrigin })), 201);
  } catch (error) {
    return failure(error);
  }
}
