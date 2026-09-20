import { z } from "zod";

import { placeOrderHold } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({ holdType: z.string().trim().max(60).optional(), reason: z.string().trim().min(1).max(2000) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.hold", schema, async (client, context, input) => ({ hold: await placeOrderHold(client, context, id, input) }), 201);
}
