import { getReservationBreakdown } from "@vercentlabs/api";
import { STOCK_RESERVATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Which documents hold an item's reserved stock. ?itemId=&warehouseId=
export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = { itemId: url.searchParams.get("itemId") ?? "", warehouseId: url.searchParams.get("warehouseId") };
  return inventoryRead(request, async (client, context) => ({ breakdown: await getReservationBreakdown(client, context, input) }), STOCK_RESERVATION_PERMISSIONS.viewSources);
}
