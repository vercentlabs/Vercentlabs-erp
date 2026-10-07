import { createPurchaseReturnFromRejection } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// A purchase return for the rejected goods, from the original receipt; it resolves the case.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await createPurchaseReturnFromRejection(client, context, id, input) }), 201, "procurement.returns.manage");
}
