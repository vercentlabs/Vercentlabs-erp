import { z } from "zod";

import { updateShipmentDetails } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Carrier, tracking, vehicle, expected date and packages, until the goods are delivered.
const schema = z.object({
  carrier: z.string().max(120).nullable().optional(),
  trackingNumber: z.string().max(120).nullable().optional(),
  trackingUrl: z.string().max(500).nullable().optional(),
  vehicleReference: z.string().max(120).nullable().optional(),
  packageCount: z.number().int().min(0).nullable().optional(),
  expectedDeliveryDate: z.string().date().nullable().optional(),
  packageNotes: z.string().max(1000).nullable().optional(),
  expectedVersion: z.number().int().optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.delivery.edit", schema, async (client, context, input) => ({ result: await updateShipmentDetails(client, context, id, input) }));
}
