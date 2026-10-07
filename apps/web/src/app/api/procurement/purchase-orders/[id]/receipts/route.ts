import { createGoodsReceiptFromPurchaseOrder } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// A goods receipt against the order (defaulting to what is still to receive); post: true posts it at once.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await createGoodsReceiptFromPurchaseOrder(client, context, id, input) }), 201,
    "procurement.receipts.manage");
}
