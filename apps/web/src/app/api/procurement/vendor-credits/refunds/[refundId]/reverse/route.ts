import { reverseSupplierRefund } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// A supplier refund recorded in error (bounced, wrong credit): Finance reverses it and the credit gets the amount back. Body: { reason }.
type Params = { params: Promise<{ refundId: string }> };

export async function POST(request: Request, ctx: Params) {
  const { refundId } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await reverseSupplierRefund(client, context, refundId, input as Record<string, unknown>) }), 200, "procurement.view");
}
