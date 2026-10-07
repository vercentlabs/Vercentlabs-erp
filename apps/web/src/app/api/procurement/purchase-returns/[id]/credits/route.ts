import { linkSupplierCreditToPurchaseReturn } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Links a vendor credit raised on the bill (not from this return) to the return's billed goods. Body: { creditId }.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await linkSupplierCreditToPurchaseReturn(client, context, id, input) }), 200, "procurement.returns.resolve");
}
