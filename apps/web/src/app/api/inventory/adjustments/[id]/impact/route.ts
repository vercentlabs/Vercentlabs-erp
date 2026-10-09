import { getAdjustmentImpact } from "@vercentlabs/api";
import { STOCK_ADJUSTMENT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// The preview against stock as it is now: current and projected on hand, reserved and available per line, stale counts, the reservations a
// shortage breaks, and (with the cost permission) the estimated value.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryRead(request, async (client, context) => ({ impact: await getAdjustmentImpact(client, context, id) }), STOCK_ADJUSTMENT_PERMISSIONS.view);
}
