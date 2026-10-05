import { z } from "zod";

import { createDeliveryFromSalesOrder, getDeliveryProposal } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// What a new delivery of the order would carry: the goods lines with what each can take now; services need no delivery.
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.order.view", async (client, context) => ({ proposal: await getDeliveryProposal(client, context, id) }));
}

// A new Draft delivery; no stock moves until it is dispatched. The idempotency key makes a double click create one delivery.
const schema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  lines: z.array(z.object({ salesOrderLineId: z.string().uuid(), quantity: z.union([z.number(), z.string()]) })).max(500).optional(),
  warehouseId: z.string().uuid().optional(),
  deliveryInstructions: z.string().max(2000).optional(),
  internalNotes: z.string().max(2000).optional(),
});

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.fulfillment.request", schema, async (client, context, input) => ({ result: await createDeliveryFromSalesOrder(client, context, id, input) }), 201);
}
