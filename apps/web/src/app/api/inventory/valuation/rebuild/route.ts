import { rebuildInventoryValuationProjection } from "@vercentlabs/api";
import { STOCK_VALUATION_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Rebuilds the valuation balances and FIFO layers from the valuation entries (administrators). Recorded with its reason.
export async function POST(request: Request) {
  return inventoryMutation(request, z.object({ reason: z.string().min(1).max(500) }), async (client, context, input) => ({ result: await rebuildInventoryValuationProjection(client, context, input) }),
    200, STOCK_VALUATION_PERMISSIONS.rebuild);
}
