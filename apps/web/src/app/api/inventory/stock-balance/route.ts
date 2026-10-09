import { getStockBalance } from "@vercentlabs/api";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

const FILTERS = ["view", "warehouseId", "locationId", "itemId", "categoryId", "batchId", "search", "disposition", "status", "includeZero", "asOf", "limit", "offset"] as const;

// The current stock position (derived from the Inventory ledger and the active reservations; never edited). ?view=all|available|reserved|
// restricted|in_transit|zero|by_warehouse|by_item|by_batch and filters; ?asOf=YYYY-MM-DD gives on hand at the end of that day.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return inventoryRead(request, (client, context) => getStockBalance(client, context, filters));
}
