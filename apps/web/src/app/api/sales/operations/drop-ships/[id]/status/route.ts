import { z } from "zod";

import { updateSalesDropShipStatus } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// F056: move a supplier-direct shipment along: ordered → shipped → delivered.
const schema = z.object({ status: z.enum(["ordered", "shipped", "delivered", "cancelled"]), procurementReference: z.string().trim().max(120).nullish(), carrier: z.string().trim().max(120).nullish(), trackingNumber: z.string().trim().max(120).nullish(), note: z.string().trim().max(1000).nullish() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.fulfillment.request", schema, async (client, context, input) => ({ result: await updateSalesDropShipStatus(client, context, id, input) }));
}
