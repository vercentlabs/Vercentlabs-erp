import { z } from "zod";

import { cancelDraftInvoice } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Cancels a draft; its number is kept, cancelled.
const schema = z.object({ reason: z.string().max(1000).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.invoice.edit", schema, async (client, context, input) => ({ result: await cancelDraftInvoice(client, context, id, input) }));
}
