import { createPurchaseOrderFromQuotation } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Creates the purchase order from the quotation, keeping its prices. A quotation converts once.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await createPurchaseOrderFromQuotation(client, context, id, input) }), 201, "procurement.po.create");
}
