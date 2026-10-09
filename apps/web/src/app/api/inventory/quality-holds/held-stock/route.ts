import { listHeldStock } from "@vercentlabs/api";
import { STOCK_HOLD_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Held stock by position and disposition, and how much of it a hold case explains: ?warehouseId=, ?itemId=, ?disposition=
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["warehouseId", "itemId", "disposition"].map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return inventoryRead(request, (client, context) => listHeldStock(client, context, filters), STOCK_HOLD_PERMISSIONS.view);
}
