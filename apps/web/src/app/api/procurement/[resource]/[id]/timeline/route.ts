import { getProcurementGovernanceTimeline } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

export async function GET(request: Request, ctx: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ timeline: await getProcurementGovernanceTimeline(client, context, resource, id) }));
}
