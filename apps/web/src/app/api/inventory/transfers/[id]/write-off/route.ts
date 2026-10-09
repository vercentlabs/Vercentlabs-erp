import { writeOffTransitLoss } from "@vercentlabs/api";
import { STOCK_TRANSFER_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Write off goods confirmed lost in transit, with a reason. Never automatic.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await writeOffTransitLoss(client, context, id, input) }), 200,
    STOCK_TRANSFER_PERMISSIONS.writeOff);
}
