import { z } from "zod";

import { setManufacturingItemPolicy } from "@vercentlabs/api";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// A product's manufacturing policy: make to order or to stock, lead time, batch and increment, default warehouses.
const schema = z.object({
  supplyPolicy: z.enum(["MAKE_TO_ORDER", "MAKE_TO_STOCK"]), leadTimeDays: z.union([z.number().int(), z.string()]).nullable().optional(),
  minimumBatchQuantity: z.union([z.string(), z.number()]).nullable().optional(), quantityIncrement: z.union([z.string(), z.number()]).nullable().optional(),
  materialWarehouseId: z.string().uuid().nullable().optional(), manufacturingWarehouseId: z.string().uuid().nullable().optional(),
});

export async function PUT(request: Request, ctx: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => ({ policy: await setManufacturingItemPolicy(client, context, itemId, input) }));
}
