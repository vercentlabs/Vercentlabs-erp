import { createGoodsReceiptWithoutOrder, listGoodsReceipts } from "@vercentlabs/api";

import { asPage, procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Goods receipts, newest first: by view (all, draft, posted, cancelled_reversed, mine), status, supplier, order, warehouse, product, who received them, dates and search.
const FILTERS = ["limit", "offset", "view", "status", "receivedById", "purchaseOrderId", "supplierId", "warehouseId", "productId", "dateFrom", "dateTo", "search"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
  return procurementRead(request, async (client, context) => asPage(await listGoodsReceipts(client, context, filters)), "procurement.po.view");
}

// Goods that came without an order (Create-Where-You-Are PR3): the receipt raises and confirms a matching order, then drafts the receipt.
export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({
    result: await createGoodsReceiptWithoutOrder(client, context, input as Parameters<typeof createGoodsReceiptWithoutOrder>[2]),
  }), 201, "procurement.receipts.manage");
}
