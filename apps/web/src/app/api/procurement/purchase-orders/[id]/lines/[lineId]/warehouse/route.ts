import { changePurchaseOrderLineWarehouse } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Receives a confirmed line in another warehouse.
type Params = { params: Promise<{ id: string; lineId: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id, lineId } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await changePurchaseOrderLineWarehouse(client, context, id, lineId, input) }), 200,
    "procurement.po.change_warehouse");
}
