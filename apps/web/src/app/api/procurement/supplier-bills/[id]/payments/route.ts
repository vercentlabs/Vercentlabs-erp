import { recordSupplierBillPayment } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Records a supplier payment from the bill through Finance (approved when Finance requires), and allocates it to the bill.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await recordSupplierBillPayment(client, context, id, input) }), 201, "accounting.payments.manage");
}
