import { getGoodsReceipt, updateDraftGoodsReceipt } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// One goods receipt with its lines, dispositions, stock movements, bill matching, returns, discrepancies and history; editing a draft.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => getGoodsReceipt(client, context, id), "procurement.po.view");
}

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await updateDraftGoodsReceipt(client, context, id, input) }), 200, "procurement.receipts.manage");
}
