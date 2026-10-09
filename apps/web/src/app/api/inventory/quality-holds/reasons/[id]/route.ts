import { updateHoldReason } from "@vercentlabs/api";
import { STOCK_HOLD_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// A reason in use is deactivated, never deleted.
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ reason: await updateHoldReason(client, context, id, input) }), 200,
    STOCK_HOLD_PERMISSIONS.manageReasons);
}
