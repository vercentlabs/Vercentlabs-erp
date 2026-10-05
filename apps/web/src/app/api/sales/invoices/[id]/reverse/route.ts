import { z } from "zod";

import { reverseSalesInvoice } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Reverses a posted invoice with nothing applied to it.
const schema = z.object({ reason: z.string().trim().min(1).max(1000) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.invoice.reverse", schema, async (client, context, input) => ({ result: await reverseSalesInvoice(client, context, id, input) }));
}
