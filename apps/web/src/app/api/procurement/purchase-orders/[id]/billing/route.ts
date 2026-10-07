import { getPurchaseOrderBillingProgress } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// The order's billing progress: status, per line ordered / cancelled / received / posted billed / drafts / remaining commitment / eligible now,
// agreed and billed value; with the supplier bills and Finance's paid and outstanding amounts for those who may see bills.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ billing: await getPurchaseOrderBillingProgress(client, context, id) }), "procurement.po.view");
}
