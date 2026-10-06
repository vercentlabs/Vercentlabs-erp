import { z } from "zod";

import { closeSalesOrder } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Closes a confirmed order by hand, with a reason: nothing left to deliver, no open draft delivery or invoice.
const schema = z.object({ reason: z.string().trim().min(1).max(1000) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.close", schema, async (client, context, input) => ({ result: await closeSalesOrder(client, context, id, input) }));
}
