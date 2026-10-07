import { cancelInvalidRejectionCase } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Cancels a case recorded in error or twice; nothing it pointed at is undone.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await cancelInvalidRejectionCase(client, context, id, input) }), 200, "procurement.rejections.cancel");
}
