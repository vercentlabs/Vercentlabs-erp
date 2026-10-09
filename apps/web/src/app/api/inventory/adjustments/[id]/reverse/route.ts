import { reverseInventoryAdjustment } from "@vercentlabs/api";
import { STOCK_ADJUSTMENT_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Reverse a posting mistake: every movement compensated, the journal reversed, the original kept.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await reverseInventoryAdjustment(client, context, id, { reason: typeof input.reason === "string" ? input.reason : "" }) }), 200,
    STOCK_ADJUSTMENT_PERMISSIONS.reverse);
}
