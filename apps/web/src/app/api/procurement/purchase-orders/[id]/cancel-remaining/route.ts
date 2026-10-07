import { cancelRemainingPurchaseOrderQty } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Cancels outstanding quantity; the ordered quantity is kept.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await cancelRemainingPurchaseOrderQty(client, context, id, input) }), 200, "procurement.po.cancel");
}
