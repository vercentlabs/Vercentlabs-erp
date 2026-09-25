import { z } from "zod";

import { recordFulfillmentShipment } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({ carrier: z.string().trim().min(1).max(120), trackingNumber: z.string().trim().max(120).nullish(), shippedAt: z.string().nullish() });

// F049: carrier and tracking for a completed fulfilment.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.fulfillment.request", schema, async (client, context, input) => ({
    shipment: await recordFulfillmentShipment(client, context, id, input),
  }));
}
