import { z } from "zod";

import { reopenClosedSalesOrder } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Reopens an order that was closed by hand; it is Confirmed again with what was left.
const schema = z.object({ reason: z.string().trim().min(1).max(1000) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.reopen_closed", schema, async (client, context, input) => ({ result: await reopenClosedSalesOrder(client, context, id, input) }));
}
