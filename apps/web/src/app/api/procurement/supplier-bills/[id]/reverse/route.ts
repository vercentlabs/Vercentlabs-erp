import { reverseSupplierBill } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Reverses a posted bill nothing has settled; Finance reverses its journals and tax entries.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await reverseSupplierBill(client, context, id, input) }), 200, "procurement.bills.reverse");
}
