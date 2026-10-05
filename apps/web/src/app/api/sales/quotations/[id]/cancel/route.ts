import { z } from "zod";

import { cancelQuotation } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// A quotation that will not go ahead; the reason is required.
const schema = z.object({ reason: z.string().max(1000) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.quotation.cancel", schema, async (client, context, input) => ({ result: await cancelQuotation(client, context, id, input) }));
}
