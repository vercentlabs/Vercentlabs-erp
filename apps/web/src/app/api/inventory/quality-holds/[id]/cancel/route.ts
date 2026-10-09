import { cancelStockHold } from "@vercentlabs/api";
import { STOCK_HOLD_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Only a draft is cancelled: a placed hold is released or resolved.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.object({ reason: z.string().max(500).nullable().optional() }), async (client, context, input) => ({ detail: await cancelStockHold(client, context, id, input) }),
    200, STOCK_HOLD_PERMISSIONS.editDraft);
}
