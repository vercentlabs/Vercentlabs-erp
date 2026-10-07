import { getGoodsReceiptBillingEligibility } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Supplier bill matching of a goods receipt: per receipt line what may be billed, what posted bills allocated, drafts, what is left; its bills.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ billing: await getGoodsReceiptBillingEligibility(client, context, id) }), "procurement.po.view");
}
