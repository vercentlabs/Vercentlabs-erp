import { getFinishedGoodsReceiptReport } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET a finished-goods receipt report (?kind=by-mo|by-date|by-item|by-warehouse|accepted-unreceived|partial-summary|reversals|traceability
// &from=&to=&warehouseId=&orderId=&itemId=&lot=&serial=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") || "by-date";
  const filters = Object.fromEntries(["from", "to", "warehouseId", "orderId", "itemId", "lot", "serial"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ kind, rows: await getFinishedGoodsReceiptReport(client, context, kind, filters) }));
}
