import { reverseInventoryTransfer } from "@vercentlabs/api";
import { STOCK_TRANSFER_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Reverse a completed transfer: every posting reversed, the stock back where it came from.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await reverseInventoryTransfer(client, context, id, { reason: typeof input.reason === "string" ? input.reason : "" }) }), 200,
    STOCK_TRANSFER_PERMISSIONS.reverse);
}
