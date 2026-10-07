import { getPurchaseOrder, updateDraftPurchaseOrder } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// One order with its lines, progress, versions, communication, related documents and history; editing a draft.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => getPurchaseOrder(client, context, id), "procurement.po.view");
}

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await updateDraftPurchaseOrder(client, context, id, input) }), 200, "procurement.po.create");
}
