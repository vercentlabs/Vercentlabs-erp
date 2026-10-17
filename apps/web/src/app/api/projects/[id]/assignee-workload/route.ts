import { getProjectTeamWorkload } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// The team's open work on the project, and the people still holding tasks they can no longer do.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ workload: await getProjectTeamWorkload(client, context, id) }), "projects.tasks.view");
}
