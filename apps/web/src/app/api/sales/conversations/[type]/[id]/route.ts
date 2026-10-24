import { getDocumentConversation } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// The customer side of a document: whom to call, message or email, and the emails sent with it and the replies (CRM parity).
const TYPES = ["sales.quotation", "sales.order", "sales.invoice", "sales.credit_note"] as const;

export async function GET(request: Request, route: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await route.params;
  if (!TYPES.includes(type as (typeof TYPES)[number])) return Response.json({ ok: false, message: "Not available on this document." }, { status: 404 });
  return salesRead(request, "sales.view", async (client, context) => getDocumentConversation(client, context, type as (typeof TYPES)[number], id));
}
