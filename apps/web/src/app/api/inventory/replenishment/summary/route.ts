import { getReorderSummary } from "@vercentlabs/api";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Reorder status for an item (?itemId, per warehouse) or a warehouse (?warehouseId, counts): null without View Reorder Levels.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return inventoryRead(request, async (client, context) => ({
    summary: await getReorderSummary(client, context, { itemId: url.searchParams.get("itemId"), warehouseId: url.searchParams.get("warehouseId") }),
  }));
}
