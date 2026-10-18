import { postVisitorMessage, readVisitorChat } from "@vercentlabs/api/crm";
import { readRequestBytes } from "@vercentlabs/api";

import { ingressTransaction } from "@/core/db";

// A visitor's conversation (CRM plan 5.8): the token is sent in the x-chat-token header. GET ?after= the newest messages; POST { body }.
type Params = { params: Promise<{ key: string }> };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const failure = (error: unknown) => {
  const shaped = error as { status?: number; message?: string; code?: string };
  const status = typeof shaped?.status === "number" && shaped.status >= 400 && shaped.status < 500 ? shaped.status : 500;
  return json({ error: { message: status === 500 ? "The chat is not available right now." : shaped.message, code: shaped.code } }, status);
};

export async function GET(request: Request, { params }: Params) {
  try {
    const { key } = await params;
    const after = new URL(request.url).searchParams.get("after");
    return json(await ingressTransaction((client) => readVisitorChat(client, key, request.headers.get("x-chat-token") ?? "", { after })));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { key } = await params;
    const body = JSON.parse(new TextDecoder().decode(await readRequestBytes(request, 16 * 1024)) || "{}");
    return json(await ingressTransaction((client) => postVisitorMessage(client, key, request.headers.get("x-chat-token") ?? "", String(body.body ?? ""))), 201);
  } catch (error) {
    return failure(error);
  }
}
