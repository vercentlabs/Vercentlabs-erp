import { z } from "zod";

import { cancelStockCount } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Cancel (a started count needs a reason); nothing adjusted, the freeze released. body: { reason? }
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await cancelStockCount(client, context, id, input) }), 200,
    STOCK_COUNT_PERMISSIONS.view);
}
