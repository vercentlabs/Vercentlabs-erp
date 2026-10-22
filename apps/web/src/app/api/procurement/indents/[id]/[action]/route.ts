import { approvePurchaseIndent, cancelPurchaseIndent, closePurchaseIndent, rejectPurchaseIndent, submitPurchaseIndent } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

import { HttpError } from "@/core/http";

// submit · approve · reject (reason) · close · cancel
type Params = { params: Promise<{ id: string; action: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => {
    if (action === "submit") return { result: await submitPurchaseIndent(client, context, id) };
    if (action === "approve") return { result: await approvePurchaseIndent(client, context, id, input) };
    if (action === "reject") return { result: await rejectPurchaseIndent(client, context, id, input) };
    if (action === "close") return { result: await closePurchaseIndent(client, context, id) };
    if (action === "cancel") return { result: await cancelPurchaseIndent(client, context, id) };
    throw new HttpError(404, "Unknown action.");
  });
}
