import { listGoodsReceipts } from "@vercentlabs/api";

import { asPage, procurementRead } from "@/features/procurement/shared/route-helpers";

// Goods receipts, newest first: by view (all, draft, posted, cancelled_reversed, mine), status, supplier, order, warehouse, product, who received them, dates and search.
const FILTERS = ["limit", "offset", "view", "status", "receivedById", "purchaseOrderId", "supplierId", "warehouseId", "productId", "dateFrom", "dateTo", "search"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
  return procurementRead(request, async (client, context) => asPage(await listGoodsReceipts(client, context, filters)), "procurement.po.view");
}
