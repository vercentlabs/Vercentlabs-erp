import { z } from "zod";

import { releaseSalesOrderReservation } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Releases the stock reserved for the order, or for one of its lines.
const schema = z.object({ lineId: z.string().uuid().optional(), reason: z.string().max(500) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.reserve", schema, async (client, context, input) => ({ result: await releaseSalesOrderReservation(client, context, id, input) }));
}
