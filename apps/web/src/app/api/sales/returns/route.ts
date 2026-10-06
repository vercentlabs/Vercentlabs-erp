import { listSalesReturns } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

const FILTER_KEYS = [
  "view", "search", "status", "partyId", "warehouseId", "reasonCode", "productId", "salesOrderId", "deliveryId", "invoiceId", "credited", "dateFrom", "dateTo", "sort", "direction", "limit", "offset",
] as const;

// Sales → Returns: every return the caller may see.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return salesRead(request, "sales.return.view", async (client, context) => await listSalesReturns(client, context, filters));
}
