import { shareRfqSupplierLink } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// The link a supplier answers the price request with ({ supplierId }): its page, the message and the WhatsApp link.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({
    result: await shareRfqSupplierLink(client, context, id, String((input as { supplierId?: unknown }).supplierId ?? "")),
  }));
}
