import { z } from "zod";

import { confirmSalesOrder } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Draft → Confirmed: validated and priced again by the server against the
// version the user reviewed, recorded as the next confirmation revision and,
// when Sales settings say so, reserving the stock that is available. When the
// order is not ready, nothing changes and the reasons come back.
const schema = z.object({
  expectedVersionNumber: z.number().int().positive(),
  quotationVarianceReason: z.string().max(1000).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.confirm", schema, async (client, context, input) => ({ result: await confirmSalesOrder(client, context, id, input) }));
}
