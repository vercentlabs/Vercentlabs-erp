import { getMilestoneDetails, updateProjectMilestone } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// One milestone: everything on it, readiness and what the person may do; and its edit (a due-date change carries a reason).
type Params = { params: Promise<{ milestoneId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { milestoneId } = await ctx.params;
  return projectsRead(request, async (client, context) => getMilestoneDetails(client, context, milestoneId), "projects.milestones.view");
}
export async function PATCH(request: Request, ctx: Params) {
  const { milestoneId } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => updateProjectMilestone(client, context, milestoneId, input), 200, "projects.milestones.edit");
}
