import { getLowStockAlertCounts } from "@vercentlabs/api";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Inventory Attention: out of stock, replenishment required, low stock covered, negative stock (?warehouseId for one warehouse). Null without
// View Low-Stock Alerts.
export async function GET(request: Request) {
  const warehouseId = new URL(request.url).searchParams.get("warehouseId");
  return inventoryRead(request, async (client, context) => ({ counts: await getLowStockAlertCounts(client, context, { warehouseId }) }));
}
