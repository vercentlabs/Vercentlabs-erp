import { completeInventoryTransfer } from "@vercentlabs/api";
import { STOCK_TRANSFER_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Complete a direct transfer (or a location transfer) in one posting.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context) => ({ detail: await completeInventoryTransfer(client, context, id) }), 200,
    STOCK_TRANSFER_PERMISSIONS.dispatch);
}
