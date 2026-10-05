import { z } from "zod";

import { recordDeliveryShipment } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// The carrier and tracking number of a delivery that has left.
const schema = z.object({ carrier: z.string().trim().min(1).max(120), trackingNumber: z.string().max(120).optional(), shippedAt: z.string().optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.fulfillment.request", schema, async (client, context, input) => ({ result: await recordDeliveryShipment(client, context, id, input) }));
}
