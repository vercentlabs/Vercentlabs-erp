import { getProjectRevenueSummary } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// A project's revenue: contract value, net invoiced, recognized revenue and collections as separate measures, unbilled work and the forecast.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ summary: await getProjectRevenueSummary(client, context, id) }));
}
