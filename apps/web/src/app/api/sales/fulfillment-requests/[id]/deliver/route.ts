import { z } from "zod";

import { recordFulfillmentDelivery } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({ receivedBy: z.string().trim().min(1).max(160), deliveredAt: z.string().nullish(), note: z.string().trim().max(1000).nullish() });

// F049: proof of delivery — who received it and when.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.fulfillment.request", schema, async (client, context, input) => ({
    delivery: await recordFulfillmentDelivery(client, context, id, input),
  }));
}
