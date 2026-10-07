import { getSupplierDebitClaim, updateDraftDebitClaim } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// One debit note to a supplier (GET) and its draft edits (PATCH).
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementRead(request, async (client, context) => getSupplierDebitClaim(client, context, id), "procurement.view");
}

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await updateDraftDebitClaim(client, context, id, input as Record<string, unknown>) }), 200, "procurement.view");
}
