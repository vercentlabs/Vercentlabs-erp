import { receiveInventoryTransfer } from "@vercentlabs/api";
import { STOCK_TRANSFER_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Receive what arrived, fully or partly (per line: quantity, batches or serial numbers; receiving location). A retry with the same key receives nothing more.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await receiveInventoryTransfer(client, context, id, input) }), 200,
    STOCK_TRANSFER_PERMISSIONS.receive);
}
