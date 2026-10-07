import { changePurchaseOrderMatchingPolicy } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Changes the order's matching policy (3-Way on accepted goods, 3-Way on received goods, 2-Way). Body: { policy, reason }. Restricted and audited.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await changePurchaseOrderMatchingPolicy(client, context, id, input) }), 200,
    "procurement.matching.override");
}
