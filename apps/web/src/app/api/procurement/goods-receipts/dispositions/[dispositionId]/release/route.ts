import { releaseHeldGoods } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Releases goods held at receipt into usable stock (an Inventory transfer); the receipt is not changed.
type Params = { params: Promise<{ dispositionId: string }> };

export async function POST(request: Request, ctx: Params) {
  const { dispositionId } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await releaseHeldGoods(client, context, dispositionId, input) }), 200, "procurement.receipts.release");
}
