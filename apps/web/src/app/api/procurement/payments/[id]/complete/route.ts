import { completeSupplierPayment } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Posts a payment from "Pay selected" once Finance approved it; it settles the bills it was approved for.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context) => ({ result: await completeSupplierPayment(client, context, id) }), 200, "procurement.bills.view");
}
