import { cancelSupplierQuotation } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Cancels an open quotation.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context) => ({ result: await cancelSupplierQuotation(client, context, id) }), 200, "procurement.quotations.manage");
}
