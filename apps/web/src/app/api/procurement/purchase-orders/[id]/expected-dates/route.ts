import { updatePurchaseOrderExpectedDates } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Moves a confirmed order's expected delivery, with the reason in its history.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await updatePurchaseOrderExpectedDates(client, context, id, input) }), 200, "procurement.po.update_dates");
}
