import { reversePostedPurchaseReturn } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// The goods came back: an inbound correction. Body: { reason, goodsReceivedBack: true }.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await reversePostedPurchaseReturn(client, context, id, input) }), 200, "procurement.returns.reverse");
}
