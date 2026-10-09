import { placeStockOnHold } from "@vercentlabs/api";
import { STOCK_HOLD_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Place the stock on hold: checked again, reservation conflicts resolved, the stock moved into hold, all at once. A retry places nothing more.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await placeStockOnHold(client, context, id, input) }), 200,
    STOCK_HOLD_PERMISSIONS.view);
}
