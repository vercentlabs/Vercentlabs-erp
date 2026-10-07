import { reversePostedGoodsReceipt } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Reverses a posted receipt nothing has used yet: its stock is taken back out; the receipt and its history stay.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await reversePostedGoodsReceipt(client, context, id, input) }), 200, "procurement.receipts.reverse");
}
