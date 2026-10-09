import { getValuationMovements } from "@vercentlabs/api";
import { STOCK_VALUATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Value movements with their running value: ?itemId=, ?warehouseId=, ?from=, ?to=, ?order=asc|desc, ?limit=
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["itemId", "warehouseId", "from", "to", "order", "limit"].map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return inventoryRead(request, (client, context) => getValuationMovements(client, context, filters), STOCK_VALUATION_PERMISSIONS.viewMovements);
}
