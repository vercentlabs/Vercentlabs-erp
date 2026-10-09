import { z } from "zod";

import { completeStockCount } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Complete: variances posted as one Stock Adjustment, the freeze released — once. body: { resolutions? }
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await completeStockCount(client, context, id, input) }), 200,
    STOCK_COUNT_PERMISSIONS.complete);
}
