import { postGoodsReceipt } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Posts the receipt: under a lock on the order everything is checked again and the stock moves now, once.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context) => ({ result: await postGoodsReceipt(client, context, id) }), 200, "procurement.receipts.post");
}
