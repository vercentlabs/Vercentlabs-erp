import { cancelInventoryTransfer } from "@vercentlabs/api";
import { STOCK_TRANSFER_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Cancel a draft or confirmed transfer (its reservation released). A dispatched transfer is not cancelled.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await cancelInventoryTransfer(client, context, id, { reason: typeof input.reason === "string" ? input.reason : undefined }) }), 200,
    STOCK_TRANSFER_PERMISSIONS.view);
}
