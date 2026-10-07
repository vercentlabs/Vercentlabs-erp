import { validateSupplierBillForPosting } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Everything posting checks, without posting.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ validation: await validateSupplierBillForPosting(client, context, id) }), "procurement.bills.view");
}
