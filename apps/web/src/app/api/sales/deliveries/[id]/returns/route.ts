import { z } from "zod";

import { createReturnFromDelivery, getReturnProposal } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// What can come back from the delivery: delivered less what already came back.
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.return.view", async (client, context) => ({ proposal: await getReturnProposal(client, context, id) }));
}

// A new Draft return; no stock moves until it is received.
const schema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  lines: z.array(z.object({ deliveryLineId: z.string().uuid(), quantity: z.union([z.number(), z.string()]), disposition: z.enum(["restock", "inspection", "damaged", "other"]).optional(),
    reasonCode: z.string().max(40).nullable().optional() })).max(500),
  reasonCode: z.string().max(40),
  reasonNote: z.string().max(1000).optional(),
  disposition: z.enum(["restock", "inspection", "damaged", "other"]).optional(),
  warehouseId: z.string().uuid().optional(),
  returnDate: z.string().date().optional(),
  customerNotes: z.string().max(4000).optional(),
  internalNotes: z.string().max(4000).optional(),
});

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.return.create", schema, async (client, context, input) => ({ result: await createReturnFromDelivery(client, context, id, input) }), 201);
}
