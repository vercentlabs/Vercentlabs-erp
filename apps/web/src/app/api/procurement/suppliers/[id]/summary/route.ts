import { getSupplierPayablesSummary, getSupplierPurchaseSummary } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// What was bought (from procurement documents) and what is owed (from Accounts Payable; amounts only with the payables permission).
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({
    purchases: await getSupplierPurchaseSummary(client, context, id),
    payables: await getSupplierPayablesSummary(client, context, id),
  }));
}
