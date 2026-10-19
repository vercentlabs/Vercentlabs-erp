import { apiStockLevels } from "@vercentlabs/api";

import { apiList } from "@/core/api-records";

// GET /api/v1/stock-levels (scope stock.read).
export async function GET(request: Request) {
  return apiList(request, "stock.read", ({ client, principal }, query) => apiStockLevels(client, principal, query));
}
