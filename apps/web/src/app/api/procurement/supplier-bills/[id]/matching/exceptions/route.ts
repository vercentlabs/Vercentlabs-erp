import { approveSupportedMatchException } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// Accepts the bill's price, discount or charge variances as an approved exception. Body: { reason }. Never the bill's creator; supplier,
// company, order, product, unit and quantity mismatches are never accepted.
type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ matching: await approveSupportedMatchException(client, context, id, input) }), 200,
    "procurement.matching.override");
}
