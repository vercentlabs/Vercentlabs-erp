import { cancelExpenseRechargeRequest, recordExpenseRechargeInvoiced } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation } from "@/features/projects/shared/route-helpers";

// POST cancel { reason } (releases the expenses) · invoiced { customerInvoiceLineId } (Sales records the invoice line it became).
type Params = { params: Promise<{ requestId: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { requestId, action } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    if (action === "cancel") return cancelExpenseRechargeRequest(client, context, requestId, input);
    if (action === "invoiced") return recordExpenseRechargeInvoiced(client, context, requestId, input);
    throw new HttpError(404, "Unknown recharge action.", "NOT_FOUND");
  });
}
