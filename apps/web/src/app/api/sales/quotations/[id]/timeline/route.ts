import { getQuotationGovernanceTimeline } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.view", async (client, context) => ({ timeline: await getQuotationGovernanceTimeline(client, context, id) }));
}
