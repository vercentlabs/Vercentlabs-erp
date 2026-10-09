import { z } from "zod";

import { rebuildReservedStockProjection } from "@vercentlabs/api";
import { STOCK_RESERVATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Rebuild Reserved from the active allocations (no reservation is created, changed or deleted). body: { reason }
export async function POST(request: Request) {
  return inventoryMutation(request, z.object({ reason: z.string() }), async (client, context, input) => ({ result: await rebuildReservedStockProjection(client, context, input) }), 200,
    STOCK_RESERVATION_PERMISSIONS.rebuild);
}
