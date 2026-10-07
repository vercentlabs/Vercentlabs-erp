import { cancelDraftSupplierBill } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Cancels a draft that will not be posted; it never had an accounting effect.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await cancelDraftSupplierBill(client, context, id, input) }), 200, "procurement.bills.view");
}
