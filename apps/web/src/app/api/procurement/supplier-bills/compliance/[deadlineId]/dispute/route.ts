import { recordAcceptanceDispute } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// A documented objection to the goods or services behind a statutory deadline; resolved, the deadline counts again from the resolution.
// Body: { reference, raisedOn?, resolvedOn? }.
type Params = { params: Promise<{ deadlineId: string }> };

export async function POST(request: Request, ctx: Params) {
  const { deadlineId } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await recordAcceptanceDispute(client, context, deadlineId, input) }), 200, "procurement.view");
}
