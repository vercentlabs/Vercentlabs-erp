import { closeSupplierDebitClaim, issueDebitClaim, recordSupplierClaimResponse } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";
import { HttpError, errorResponse } from "@/core/http";

// A claim's commands: issue (to the supplier), respond (the supplier's decision), close.
type Params = { params: Promise<{ id: string; action: string }> };
type Input = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ACTIONS: Record<string, (client: any, context: any, id: string, input: Input) => Promise<unknown>> = {
  issue: (client, context, id, input) => issueDebitClaim(client, context, id, input),
  respond: (client, context, id, input) => recordSupplierClaimResponse(client, context, id, input),
  close: (client, context, id, input) => closeSupplierDebitClaim(client, context, id, input),
};

export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  const run = ACTIONS[action];
  if (!run) return errorResponse(new HttpError(404, "Unknown action."));
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await run(client, context, id, input as Input) }), 200, "procurement.view");
}
