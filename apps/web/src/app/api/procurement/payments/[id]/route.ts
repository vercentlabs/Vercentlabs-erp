import { getSupplierPayment } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// One supplier payment with the bills it settled and the TDS withheld on each.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => getSupplierPayment(client, context, id), "procurement.bills.view");
}
