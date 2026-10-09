import { listInventoryReservations } from "@vercentlabs/api";
import { STOCK_RESERVATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Reservations: ?status=active|all|consumed|released|cancelled|expired, ?sourceType=, ?sourceId=, ?itemId=, ?warehouseId=, ?from=, ?to=, ?search=, ?limit=, ?offset=
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["status", "sourceType", "sourceId", "itemId", "warehouseId", "from", "to", "search", "limit", "offset"].map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return inventoryRead(request, (client, context) => listInventoryReservations(client, context, filters), STOCK_RESERVATION_PERMISSIONS.view);
}
