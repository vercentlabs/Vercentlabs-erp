import { postInventoryAdjustment } from "@vercentlabs/api";
import { STOCK_ADJUSTMENT_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Post: re-checked against current stock under locks, reservation conflicts resolved as given (resolutions), Adjustment In / Out and the gain / loss journal posted — once.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await postInventoryAdjustment(client, context, id, input) }), 200,
    STOCK_ADJUSTMENT_PERMISSIONS.view);
}
