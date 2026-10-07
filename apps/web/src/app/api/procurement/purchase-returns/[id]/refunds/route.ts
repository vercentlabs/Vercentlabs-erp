import { linkSupplierRefund } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Money the supplier refunded, as Finance received it. Body: { amount, reference, quantity?, receivedOn? }.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await linkSupplierRefund(client, context, id, input) }), 200, "procurement.returns.resolve");
}
