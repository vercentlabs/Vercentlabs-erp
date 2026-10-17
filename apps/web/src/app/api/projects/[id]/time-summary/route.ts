import { getProjectTimeSummary } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// A project's time: its billing policy, totals by status, task and person (cost and billing for those who may see them).
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ summary: await getProjectTimeSummary(client, context, id) }));
}
