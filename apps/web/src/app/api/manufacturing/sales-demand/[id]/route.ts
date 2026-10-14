import { getSalesDemand } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One demand: its coverage, recommendation, linked orders, candidate supply and history.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ demand: await getSalesDemand(client, context, id) }));
}
