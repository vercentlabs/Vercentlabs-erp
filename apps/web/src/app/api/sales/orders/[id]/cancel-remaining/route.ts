import { z } from "zod";

import { cancelSalesOrderRemaining } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Cancels what is left on the order's lines; what was delivered and invoiced stays.
const schema = z.object({ lines: z.array(z.object({ salesOrderLineId: z.string().uuid(), quantity: z.union([z.number(), z.string()]).optional() })).max(500).optional(), reasonCode: z.string().max(40).optional(), reason: z.string().max(1000).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.cancel_remaining", schema, async (client, context, input) => ({ result: await cancelSalesOrderRemaining(client, context, id, input) }));
}
