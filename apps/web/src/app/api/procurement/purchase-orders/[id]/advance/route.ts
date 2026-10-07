import { recordPurchaseOrderAdvance } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Finance pays the advance the confirmed order's payment terms expect: a supplier advance recorded against the order (never a bill).
// Body: { amount, paymentDate?, paymentMethod?, bankAccountId?, reference?, idempotencyKey? }.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await recordPurchaseOrderAdvance(client, context, id, input) }), 200, "procurement.view");
}
