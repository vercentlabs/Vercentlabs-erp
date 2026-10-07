import { createPurchaseReturnFromGoodsReceipt } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// A purchase return (draft) from this goods receipt: the lines given, or every line's usable stock (reasonCode).
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await createPurchaseReturnFromGoodsReceipt(client, context, id, input) }), 201, "procurement.returns.manage");
}
