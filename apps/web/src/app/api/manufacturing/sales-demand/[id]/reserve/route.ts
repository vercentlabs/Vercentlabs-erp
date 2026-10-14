import { z } from "zod";

import { reserveDemandForSales } from "@vercentlabs/api";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// Reserve stock for the demand's Sales Order line (received output first) through Sales and Inventory.
const schema = z.object({ quantity: z.union([z.string(), z.number()]).optional(), idempotencyKey: z.string().trim().min(1).max(200).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => ({ demand: await reserveDemandForSales(client, context, id, input) }));
}
