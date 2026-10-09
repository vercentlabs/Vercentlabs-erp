import { z } from "zod";

import { startStockCount } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Start: capture the system stock, generate the lines and freeze the scope.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context) => ({ detail: await startStockCount(client, context, id) }), 200,
    STOCK_COUNT_PERMISSIONS.start);
}
