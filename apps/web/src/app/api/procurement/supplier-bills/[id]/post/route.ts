import { postSupplierBill } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Posts the bill through Finance: approval when Finance requires it, then the payable, input tax, reverse charge and TDS, once.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await postSupplierBill(client, context, id, input) }), 200, "accounting.payables.manage");
}
