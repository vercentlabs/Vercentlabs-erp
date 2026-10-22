import { z } from "zod";

import { einvoiceAfterPost, postDebitNote } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Posts the debit note; with "e-invoice on posting" switched on, its IRN (type DBN) follows without undoing the posting.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", z.object({}), async (client, context) => {
    const result = await postDebitNote(client, context, id);
    const einvoice = result.status === "posted" && !result.replayed ? await einvoiceAfterPost(client, context, id) : null;
    return { result: { ...result, einvoice } };
  });
}
