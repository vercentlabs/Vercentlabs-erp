import { listSalesDemand } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Confirmed customer demand for manufactured products (?status=OPEN|all|<status>&search=&itemId=&warehouseId=&from=&to=&bom=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["status", "search", "itemId", "warehouseId", "from", "to", "bom"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => await listSalesDemand(client, context, filters));
}
