import { listNegativeStock } from "@vercentlabs/api";
import { NEGATIVE_STOCK_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

import { negativeStockFilters } from "./filters";

// The negative-stock report: ?status=open|resolved|all, ?warehouseId=, ?itemId=, ?categoryId=, ?reasonCode=, ?userId=, ?from=, ?to=, ?search=, ?limit=, ?offset=
export async function GET(request: Request) {
  const filters = negativeStockFilters(request);
  return inventoryRead(request, (client, context) => listNegativeStock(client, context, filters), NEGATIVE_STOCK_PERMISSIONS.viewExceptions);
}
