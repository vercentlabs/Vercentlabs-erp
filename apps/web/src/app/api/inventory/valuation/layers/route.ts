import { getFifoLayers } from "@vercentlabs/api";
import { STOCK_VALUATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// FIFO cost layers: ?itemId=, ?warehouseId=, ?includeExhausted=true
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["itemId", "warehouseId", "includeExhausted"].map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return inventoryRead(request, (client, context) => getFifoLayers(client, context, filters), STOCK_VALUATION_PERMISSIONS.viewLayers);
}
