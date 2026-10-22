import { awardPurchaseRfq, cancelPurchaseRfq, closePurchaseRfq, declineRfqSupplier, recordRfqQuotation, sendPurchaseRfq } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

import { HttpError } from "@/core/http";

// send · quotation (a supplier's answer) · decline · award · cancel · close
type Params = { params: Promise<{ id: string; action: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => {
    if (action === "send") return { result: await sendPurchaseRfq(client, context, id, input) };
    if (action === "quotation") return { result: await recordRfqQuotation(client, context, id, input) };
    if (action === "decline") return { result: await declineRfqSupplier(client, context, id, input) };
    if (action === "award") return { result: await awardPurchaseRfq(client, context, id, input) };
    if (action === "cancel") return { result: await cancelPurchaseRfq(client, context, id) };
    if (action === "close") return { result: await closePurchaseRfq(client, context, id) };
    throw new HttpError(404, "Unknown action.");
  });
}
