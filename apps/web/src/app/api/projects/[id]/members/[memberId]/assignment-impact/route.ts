import { getMemberAssignmentImpact } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// What a team member still owns on the project, reviewed before they are removed.
type Params = { params: Promise<{ id: string; memberId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id, memberId } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ impact: await getMemberAssignmentImpact(client, context, id, memberId) }), "projects.tasks.view");
}
