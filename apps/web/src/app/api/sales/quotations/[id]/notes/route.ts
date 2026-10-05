import { z } from "zod";

import { addQuotationNote } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// An internal note on the quotation's timeline; never printed.
const schema = z.object({ note: z.string().max(4000) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.quotation.view", schema, async (client, context, input) => ({ result: await addQuotationNote(client, context, id, input) }));
}
