import { z } from "zod";

import { postCreditNote } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Posts the credit note (checked again against the invoice) and applies it to the invoice. Posting twice posts once.
const schema = z.object({ expectedVersion: z.number().int().optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.credit_note.post", schema, async (client, context, input) => ({ result: await postCreditNote(client, context, id, input) }));
}
