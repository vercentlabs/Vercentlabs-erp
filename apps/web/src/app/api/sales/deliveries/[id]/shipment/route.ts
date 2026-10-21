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
  transporterId: z.string().max(20).nullable().optional(),
  transportMode: z.enum(["road", "rail", "air", "ship"]).nullable().optional(),
  distanceKm: z.number().int().min(0).max(4000).nullable().optional(),
  transportDocumentNumber: z.string().max(30).nullable().optional(),
  transportDocumentDate: z.string().date().nullable().optional(),
  expectedVersion: z.number().int().optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.delivery.edit", schema, async (client, context, input) => ({ result: await updateShipmentDetails(client, context, id, input) }));
}
