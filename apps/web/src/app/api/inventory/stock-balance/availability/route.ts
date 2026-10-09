import { getAvailabilityBreakdown } from "@vercentlabs/api";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Why an item's available quantity is what it is, per warehouse: on hand, less each restriction, = eligible on hand, less reservations,
// = available. ?itemId=&warehouseId=
export async function GET(request: Request) {
  const url = new URL(request.url);
  return inventoryRead(request, async (client, context) => ({
    availability: await getAvailabilityBreakdown(client, context, { itemId: url.searchParams.get("itemId") ?? "", warehouseId: url.searchParams.get("warehouseId") || null }),
  }));
}
