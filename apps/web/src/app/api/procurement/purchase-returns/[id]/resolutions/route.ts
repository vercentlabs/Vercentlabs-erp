import { recordPurchaseReturnResolution } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// A replacement received or another authorised resolution. Body: { type, quantity, notes, reference? }.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await recordPurchaseReturnResolution(client, context, id, input) }), 200, "procurement.returns.resolve");
}
