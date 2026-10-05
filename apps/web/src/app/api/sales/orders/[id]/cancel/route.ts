import { z } from "zod";

import { cancelSalesOrder } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Cancels a draft, or a confirmed order with nothing delivered or invoiced. A reason is required once confirmed.
const schema = z.object({ reasonCode: z.string().max(40).optional(), reason: z.string().max(1000).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.cancel", schema, async (client, context, input) => ({ result: await cancelSalesOrder(client, context, id, input) }));
}
