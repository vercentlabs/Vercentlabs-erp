import { listDeliveries } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

const FILTER_KEYS = [
  "view", "search", "status", "partyId", "warehouseId", "salesOrderId", "carrier", "ownerUserId", "dispatchFrom", "dispatchTo", "expectedFrom", "expectedTo", "sort", "direction", "limit", "offset",
] as const;

// Sales → Deliveries: every delivery the caller may see (by its order's visibility, or all for the warehouse).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return salesRead(request, "sales.delivery.view", async (client, context) => await listDeliveries(client, context, filters));
}
