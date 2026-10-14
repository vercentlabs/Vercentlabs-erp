import { listProductionEntries } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Production entries (?status=&orderId=&batchId=&from=&to=&search=&inspection=&receivable=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["status", "orderId", "batchId", "from", "to", "search", "inspection", "receivable"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ entries: await listProductionEntries(client, context, filters) }));
}
