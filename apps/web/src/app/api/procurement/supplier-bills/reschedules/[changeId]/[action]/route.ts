import { approvePaymentReschedule, rejectPaymentReschedule } from "@vercentlabs/api";

import { errorResponse, HttpError } from "@/core/http";
import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Finance decides a requested reschedule (never whoever asked for it). Body: { note? } — a rejection needs one.
type Params = { params: Promise<{ changeId: string; action: string }> };

export async function POST(request: Request, ctx: Params) {
  const { changeId, action } = await ctx.params;
  if (action !== "approve" && action !== "reject") return errorResponse(new HttpError(404, "Unknown action."));
  return procurementMutation(request, bodySchema, async (client, context, input) => ({
    result: action === "approve" ? await approvePaymentReschedule(client, context, changeId, input) : await rejectPaymentReschedule(client, context, changeId, input),
  }), 200, "procurement.view");
}
