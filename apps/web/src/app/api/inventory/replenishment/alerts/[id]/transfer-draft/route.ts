import { createTransferDraftFromLowStockAlert } from "@vercentlabs/api";
import { STOCK_REORDER_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// A draft internal transfer into the alert's warehouse; recorded on the alert. A draft never resolves it.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ draft: await createTransferDraftFromLowStockAlert(client, context, id, input) }), 201,
    STOCK_REORDER_PERMISSIONS.createTransferDraft);
}
