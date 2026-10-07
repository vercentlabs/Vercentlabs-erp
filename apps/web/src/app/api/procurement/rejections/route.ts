import { listRejections } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Receiving rejections and the Needs Attention views: by view, stage, reason, order, receipt, supplier, warehouse, product, dates and search.
const FILTERS = ["view", "stage", "reason", "purchaseOrderId", "goodsReceiptId", "qualityInspectionId", "supplierId", "warehouseId", "productId", "dateFrom", "dateTo", "search"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
  return procurementRead(request, async (client, context) => ({ rows: await listRejections(client, context, filters) }), "procurement.rejections.view");
}
