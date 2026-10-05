import { z } from "zod";

import { reserveSalesOrderLine } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Reserves a chosen quantity of one line (never more than it still needs); all of it when no quantity is given.
const schema = z.object({ quantity: z.union([z.number(), z.string()]).optional(), idempotencyKey: z.string().max(200).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string; lineId: string }> }) {
  const { id, lineId } = await ctx.params;
  return salesMutation(request, "sales.order.reserve", schema, async (client, context, input) => ({ result: await reserveSalesOrderLine(client, context, id, { ...input, lineId }) }));
}
