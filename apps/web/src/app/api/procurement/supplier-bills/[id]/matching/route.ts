import { getSupplierBillMatchingResult, recheckSupplierBillMatching } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// 2-Way Matching of a bill against its purchase order. GET: a draft evaluated now (a posted bill: the evidence it was posted with).
// POST: Check Matching on a draft — rebuilt and evaluated against the order and posted bills as they are now, and saved.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ matching: await getSupplierBillMatchingResult(client, context, id) }), "procurement.bills.view");
}

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context) => ({ matching: await recheckSupplierBillMatching(client, context, id) }), 200, "procurement.bills.view");
}
