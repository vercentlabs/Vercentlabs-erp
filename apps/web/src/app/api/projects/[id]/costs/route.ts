import { getProjectCostSummary } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// A project's cost: actual (from its authoritative sources), budget, remaining, commitments, pending claims, ETC/EAC, breakdowns and
// profitability for those allowed. ?from=&to=&category=&source=&taskId=&milestoneId= narrow the actual.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context, url) => ({ summary: await getProjectCostSummary(client, context, id,
    Object.fromEntries(["from", "to", "category", "source", "taskId", "milestoneId"].map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value))) }));
}
