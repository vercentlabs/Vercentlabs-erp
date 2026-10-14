import { getMoConsumptionHistory } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The order's consumption notes, newest first.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ consumptions: await getMoConsumptionHistory(client, context, id) }));
}
