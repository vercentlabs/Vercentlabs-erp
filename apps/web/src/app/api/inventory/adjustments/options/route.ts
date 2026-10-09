import { getAdjustmentOptions } from "@vercentlabs/api";
import { STOCK_ADJUSTMENT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Warehouses with their locations and dispositions, reasons, cost bases, the value threshold and what the user may do.
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ options: await getAdjustmentOptions(client, context) }), STOCK_ADJUSTMENT_PERMISSIONS.view);
}
