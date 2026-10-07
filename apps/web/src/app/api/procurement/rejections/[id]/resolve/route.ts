import { recordRejectionResolution } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// A documented outcome: replacement received, refusal closed, outstanding quantity cancelled, accepted back, disposed of (or returned, through /return).
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await recordRejectionResolution(client, context, id, input) }), 200, "procurement.rejections.resolve");
}
