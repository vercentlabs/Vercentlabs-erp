import { allocateVendorCreditToBills, approveVendorCredit, cancelDraftVendorCredit, postVendorCredit, recordSupplierRefund, reverseVendorCredit, unapplyVendorCredit, validateVendorCreditForPosting } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";
import { HttpError, errorResponse } from "@/core/http";

// A vendor credit's commands: validate, post, approve, cancel (draft), reverse, allocate (to bills), unapply, refund.
type Params = { params: Promise<{ id: string; action: string }> };
type Input = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ACTIONS: Record<string, (client: any, context: any, id: string, input: Input) => Promise<unknown>> = {
  validate: (client, context, id) => validateVendorCreditForPosting(client, context, id),
  post: (client, context, id) => postVendorCredit(client, context, id),
  approve: (client, context, id) => approveVendorCredit(client, context, id),
  cancel: (client, context, id, input) => cancelDraftVendorCredit(client, context, id, input),
  reverse: (client, context, id, input) => reverseVendorCredit(client, context, id, input),
  allocate: (client, context, id, input) => allocateVendorCreditToBills(client, context, id, input),
  unapply: (client, context, id, input) => unapplyVendorCredit(client, context, id, input),
  refunds: (client, context, id, input) => recordSupplierRefund(client, context, id, input),
};

export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  const run = ACTIONS[action];
  if (!run) return errorResponse(new HttpError(404, "Unknown action."));
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await run(client, context, id, input as Input) }), 200, "procurement.view");
}
