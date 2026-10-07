import { postPurchaseReturn } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// The goods physically left: Inventory's outbound movement. Body: { dispatchConfirmed: true, dispatchedAt?, carrierReference?, trackingReference?, dispatchReference? }.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await postPurchaseReturn(client, context, id, input) }), 200, "procurement.returns.post");
}
