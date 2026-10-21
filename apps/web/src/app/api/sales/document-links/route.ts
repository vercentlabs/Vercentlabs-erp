import { z } from "zod";

import { revokeDocumentLink, shareDocumentLink } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// The customer's link to a quotation or invoice (Sales audit): POST { kind, id, revoke? } gives the link (the same one every time), or
// revokes it. Sharing needs the document's send permission (checked by the operation).
const schema = z.object({ kind: z.enum(["quotation", "invoice"]), id: z.string().uuid(), revoke: z.boolean().optional() });

export async function POST(request: Request) {
  return salesMutation(request, "sales.view", schema, async (client, context, input) => ({
    result: input.revoke ? await revokeDocumentLink(client, context, input.kind, input.id) : await shareDocumentLink(client, context, input.kind, input.id),
  }));
}
