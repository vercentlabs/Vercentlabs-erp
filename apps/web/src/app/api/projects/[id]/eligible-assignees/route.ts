import { getEligibleProjectAssignees } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// The people who may be given this project's tasks (?search=), with the work they already carry.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context, url) => ({ assignees: await getEligibleProjectAssignees(client, context, id, { search: url.searchParams.get("search") ?? "" }) }), "projects.tasks.view");
}
