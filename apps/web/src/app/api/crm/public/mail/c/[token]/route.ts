import { recordMailingClick } from "@vercentlabs/api/crm";

import { ingressTransaction } from "@/core/db";

// A link in a campaign email (CRM plan 5.8): counts the click and goes on to the page (web addresses only).
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = new URL(request.url).searchParams.get("u") ?? "";
  const { target } = await ingressTransaction((client) => recordMailingClick(client, token, url)).catch(() => ({ target: null as string | null }));
  return target ? Response.redirect(target, 302) : new Response("This link is not valid.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
