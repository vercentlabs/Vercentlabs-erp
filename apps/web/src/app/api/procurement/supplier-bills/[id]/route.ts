import { getSupplierBill, updateDraftSupplierBill } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// One supplier bill (or debit note) in full; changing a draft.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => getSupplierBill(client, context, id), "procurement.bills.view");
}

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await updateDraftSupplierBill(client, context, id, input) }), 200, "procurement.bills.view");
}
