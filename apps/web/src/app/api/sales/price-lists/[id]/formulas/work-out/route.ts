import { z } from "zod";

import { workOutPriceListPrices } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// { apply: false } shows what the rules would change; { apply: true } writes the prices.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", z.object({ apply: z.boolean() }), async (client, context, input) => workOutPriceListPrices(client, context, id, input));
}
