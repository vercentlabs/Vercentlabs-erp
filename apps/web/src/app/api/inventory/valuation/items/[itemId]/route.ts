import { getItemValuation } from "@vercentlabs/api";
import { STOCK_VALUATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// One item: its valuation method and, per warehouse, quantity, value and rate.
export async function GET(request: Request, ctx: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await ctx.params;
  return inventoryRead(request, async (client, context) => ({ valuation: await getItemValuation(client, context, itemId) }), STOCK_VALUATION_PERMISSIONS.view);
}
