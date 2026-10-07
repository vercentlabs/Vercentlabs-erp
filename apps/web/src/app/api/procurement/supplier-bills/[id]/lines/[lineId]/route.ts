import { removeDirectBillExpenseLine, updateDirectBillExpenseLine } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Changes or removes one expense line of a draft direct bill; the bill is recalculated.
type Params = { params: Promise<{ id: string; lineId: string }> };

export async function PATCH(request: Request, ctx: Params) {
  const { id, lineId } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await updateDirectBillExpenseLine(client, context, id, lineId, input) }), 200, "procurement.bills.view");
}

export async function DELETE(request: Request, ctx: Params) {
  const { id, lineId } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context) => ({ result: await removeDirectBillExpenseLine(client, context, id, lineId) }), 200, "procurement.bills.view");
}
