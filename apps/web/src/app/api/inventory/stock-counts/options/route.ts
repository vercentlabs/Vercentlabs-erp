import { getStockCountOptions } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ options: await getStockCountOptions(client, context) }), STOCK_COUNT_PERMISSIONS.view);
}
