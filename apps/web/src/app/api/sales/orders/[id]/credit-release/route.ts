import { z } from "zod";

import { requestCreditRelease } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Asks whoever can release credit to look at an order held for credit (Sales plan, Flow 1).
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.confirm", z.object({ note: z.string().max(500).optional() }), async (client, context, input) => ({ result: await requestCreditRelease(client, context, id, input) }));
}
