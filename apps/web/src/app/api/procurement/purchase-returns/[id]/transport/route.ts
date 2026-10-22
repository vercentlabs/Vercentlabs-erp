import { getPurchaseReturnTransport, updatePurchaseReturnTransport } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";


// The return's transport and e-way bill (Procurement plan Phase 2).
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ transport: await getPurchaseReturnTransport(client, context, id) }));
}

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ transport: await updatePurchaseReturnTransport(client, context, id, input) }));
}
