import { z } from "zod";

import { cancelDelivery } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Cancels a delivery before it is dispatched; a dispatched delivery is returned with a sales return.
const schema = z.object({ reasonCode: z.string().trim().min(1).max(40), reason: z.string().max(1000).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.delivery.cancel", schema, async (client, context, input) => ({ result: await cancelDelivery(client, context, id, input) }));
}
