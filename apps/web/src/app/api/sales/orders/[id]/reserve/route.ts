import { z } from "zod";

import { reserveSalesOrderStock } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Reserves the stock available for the order's lines; a line is reserved partly when stock is short.
const schema = z.object({ lineIds: z.array(z.string().uuid()).max(500).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.reserve", schema, async (client, context, input) => ({ result: await reserveSalesOrderStock(client, context, id, input) }));
}
