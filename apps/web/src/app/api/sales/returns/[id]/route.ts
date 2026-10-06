import { z } from "zod";

import { getSalesReturn, updateDraftReturn } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.return.view", async (client, context) => ({ salesReturn: await getSalesReturn(client, context, id) }));
}

// A draft's lines, reason, condition, warehouse, date and notes.
const schema = z.object({
  expectedVersion: z.number().int().optional(),
  lines: z.array(z.object({ deliveryLineId: z.string().uuid(), quantity: z.union([z.number(), z.string()]), disposition: z.enum(["restock", "inspection", "damaged", "other"]).optional(),
    reasonCode: z.string().max(40).nullable().optional() })).max(500).optional(),
  reasonCode: z.string().max(40).optional(),
  reasonNote: z.string().max(1000).nullable().optional(),
  warehouseId: z.string().uuid().optional(),
  returnDate: z.string().date().optional(),
  customerNotes: z.string().max(4000).nullable().optional(),
  internalNotes: z.string().max(4000).nullable().optional(),
});

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.return.edit", schema, async (client, context, input) => ({ result: await updateDraftReturn(client, context, id, input) }));
}
