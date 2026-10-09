import { getWarehouseValuation } from "@vercentlabs/api";
import { STOCK_VALUATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// One warehouse: its total inventory value, item by item, and its latest value movements. There is no editing a warehouse's value.
export async function GET(request: Request, ctx: { params: Promise<{ warehouseId: string }> }) {
  const { warehouseId } = await ctx.params;
  return inventoryRead(request, async (client, context) => ({ valuation: await getWarehouseValuation(client, context, warehouseId) }), STOCK_VALUATION_PERMISSIONS.view);
}
