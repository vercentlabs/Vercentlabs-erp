import { getManufacturingOrderCosting } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The order's production costing: planned baseline, actual material and applied cost, finished goods, work in progress, variances,
// reconciliation with Finance, applications, adjustments and history.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ costing: await getManufacturingOrderCosting(client, context, id) }));
}
