import { getProjectProfitabilitySummary } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// A project's profitability: actual contribution and margin, the forecast, budget variance, basis, completeness and warnings. ?from=&to= sets the period.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context, url) => ({ summary: await getProjectProfitabilitySummary(client, context, id,
    { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined }) }));
}
