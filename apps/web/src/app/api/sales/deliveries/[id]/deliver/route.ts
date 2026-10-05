import { z } from "zod";

import { markDeliveryDelivered } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// The customer received the goods.
const schema = z.object({ deliveredAt: z.string().date().optional(), receivedBy: z.string().max(160).optional(), note: z.string().max(1000).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.delivery.deliver", schema, async (client, context, input) => ({ result: await markDeliveryDelivered(client, context, id, input) }));
}
