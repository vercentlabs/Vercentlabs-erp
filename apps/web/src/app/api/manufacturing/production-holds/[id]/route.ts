import { getProductionHold } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One production hold: its reasons and who clears each, the resume request, readiness, affected customer demand and orders, and its timeline.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ hold: await getProductionHold(client, context, id) }));
}
