import { getOpeningStockOptions } from "@vercentlabs/api";
import { OPENING_STOCK_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Warehouses the user may load opening stock into, dispositions, the company currency and capabilities.
export async function GET(request: Request) {
  return inventoryRead(request, (client, context) => getOpeningStockOptions(client, context), OPENING_STOCK_PERMISSIONS.view);
}
