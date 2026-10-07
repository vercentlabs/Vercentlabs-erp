import { reverseSupplierPayment } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Reverses a supplier payment that did not happen; the bills it settled are owed again.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await reverseSupplierPayment(client, context, id, input) }), 200, "accounting.payments.approve");
}
