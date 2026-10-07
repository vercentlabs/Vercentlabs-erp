import { reconcileGoodsReceiptInventory } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// What each posted line should have put into stock against what Inventory holds for it.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => reconcileGoodsReceiptInventory(client, context, id), "procurement.po.view");
}
