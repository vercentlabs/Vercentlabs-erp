import { activatePurchaseRateContract, cancelPurchaseRateContract } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";
import { HttpError } from "@/core/http";

// activate · cancel
type Params = { params: Promise<{ id: string; action: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => {
    if (action === "activate") return { result: await activatePurchaseRateContract(client, context, id) };
    if (action === "cancel") return { result: await cancelPurchaseRateContract(client, context, id, input) };
    throw new HttpError(404, "Unknown action.");
  });
}
