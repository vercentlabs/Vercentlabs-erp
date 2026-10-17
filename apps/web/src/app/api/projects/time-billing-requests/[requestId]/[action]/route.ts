import { cancelTimeBillingRequest, confirmTimeBillingAllocation, reconcileTimeBillingAdjustments, submitTimeBillingRequest } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation } from "@/features/projects/shared/route-helpers";

// submit (to Sales) | cancel (release) | confirm (link the invoice line) | reconcile (an invoice cancellation or credit note).
type Params = { params: Promise<{ requestId: string; action: string }> };
const unknown = () => { throw new HttpError(404, "Unknown action.", "NOT_FOUND"); };
const schema = z.object({ reason: z.string().max(500).optional(), customerInvoiceLineId: z.string().uuid().optional(), creditNoteId: z.string().uuid().optional(), minutes: z.number().int().optional(), expectedVersion: z.number().int().optional(),
  disposition: z.enum(["REBILLABLE", "NOT_REBILLABLE"]).optional() });
export async function POST(request: Request, ctx: Params) {
  const { requestId, action } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => (action === "submit" ? submitTimeBillingRequest(client, context, requestId, input)
    : action === "cancel" ? cancelTimeBillingRequest(client, context, requestId, input) : action === "confirm" ? confirmTimeBillingAllocation(client, context, requestId, input)
    : action === "reconcile" ? reconcileTimeBillingAdjustments(client, context, requestId, input) : unknown()));
}
