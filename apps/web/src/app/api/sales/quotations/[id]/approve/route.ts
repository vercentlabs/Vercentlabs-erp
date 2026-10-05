import { z } from "zod";

import { approveQuotation } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Approves a quotation awaiting approval; it becomes Confirmed.
const schema = z.object({ quotationVersionId: z.string().uuid().nullish() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.quotation.approve", schema, async (client, context, input) => ({ result: await approveQuotation(client, context, id, input.quotationVersionId ?? null) }));
}
