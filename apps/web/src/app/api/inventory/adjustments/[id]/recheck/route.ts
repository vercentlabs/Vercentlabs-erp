import { refreshAdjustmentSnapshot } from "@vercentlabs/api";
import { STOCK_ADJUSTMENT_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Recheck stock after a recount: the counted lines are compared with the stock recorded now.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context) => ({ detail: await refreshAdjustmentSnapshot(client, context, id) }), 200,
    STOCK_ADJUSTMENT_PERMISSIONS.count);
}
