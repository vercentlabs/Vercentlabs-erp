import { revokePurchaseOrderLink, sharePurchaseOrderLink } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// The supplier's link to the order's PDF and a WhatsApp message with it (?phone= another number); DELETE ends the link.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) =>
    ({ result: await sharePurchaseOrderLink(client, context, id, { phone: typeof input.phone === "string" ? input.phone : null }) }));
}

export async function DELETE(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context) => ({ result: await revokePurchaseOrderLink(client, context, id) }));
}
