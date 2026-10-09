import { returnTransferToDraft } from "@vercentlabs/api";
import { STOCK_TRANSFER_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Back to draft: the reservation is released so the transfer can be changed.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context) => ({ detail: await returnTransferToDraft(client, context, id) }), 200,
    STOCK_TRANSFER_PERMISSIONS.confirm);
}
