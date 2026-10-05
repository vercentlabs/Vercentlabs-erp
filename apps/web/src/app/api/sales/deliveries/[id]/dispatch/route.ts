import { z } from "zod";

import { dispatchDelivery } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// The goods leave: stock is issued from the delivery's warehouse, consuming the lines' reservations. Dispatching twice issues once.
const schema = z.object({
  dispatchDate: z.string().date().optional(),
  carrier: z.string().max(120).nullable().optional(),
  trackingNumber: z.string().max(120).nullable().optional(),
  trackingUrl: z.string().max(500).nullable().optional(),
  vehicleReference: z.string().max(120).nullable().optional(),
  packageCount: z.number().int().min(0).nullable().optional(),
  expectedVersion: z.number().int().optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.delivery.dispatch", schema, async (client, context, input) => ({ result: await dispatchDelivery(client, context, id, input) }));
}
