import { z } from "zod";

import { submitStockCount } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Every line counted: Ready for Review.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context) => ({ detail: await submitStockCount(client, context, id) }), 200,
    STOCK_COUNT_PERMISSIONS.submit);
}
