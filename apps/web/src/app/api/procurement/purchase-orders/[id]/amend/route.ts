import { amendPurchaseOrder } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// A confirmed order nothing was done against goes back to Draft, with the reason; reconfirming makes the next version.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await amendPurchaseOrder(client, context, id, input) }), 200, "procurement.po.amend");
}
