import { getInventoryValuation } from "@vercentlabs/api";
import { STOCK_VALUATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

import { valuationFilters } from "./filters";

// What stock is worth: ?view=summary|warehouse|item, ?warehouseId=, ?itemId=, ?categoryId=, ?method=, ?search=, ?asOf=YYYY-MM-DD, ?includeZero=true, ?limit=, ?offset=
export async function GET(request: Request) {
  const filters = valuationFilters(request);
  return inventoryRead(request, (client, context) => getInventoryValuation(client, context, filters), STOCK_VALUATION_PERMISSIONS.view);
}
