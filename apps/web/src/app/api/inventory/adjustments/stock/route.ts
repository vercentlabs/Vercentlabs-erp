import { getAdjustmentStock } from "@vercentlabs/api";
import { STOCK_ADJUSTMENT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// An item's recorded stock in a warehouse for the line editor: positions (location, batch, disposition, on hand, reserved), serial numbers in stock.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = { warehouseId: url.searchParams.get("warehouseId") ?? "", itemId: url.searchParams.get("itemId") ?? "" };
  return inventoryRead(request, async (client, context) => ({ stock: await getAdjustmentStock(client, context, input) }), STOCK_ADJUSTMENT_PERMISSIONS.view);
}
