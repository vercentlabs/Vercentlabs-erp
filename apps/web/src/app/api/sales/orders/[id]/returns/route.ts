import { z } from "zod";

import { createSalesReturnRequest } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  reason: z.string().trim().min(1).max(2000),
  lines: z.array(z.object({ salesOrderLineId: z.string().uuid(), quantity: z.union([z.number(), z.string()]) })).min(1).max(500),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.amend", schema, async (client, context, input) => ({ returnRequest: await createSalesReturnRequest(client, context, id, input) }), 201);
}
