import { createProjectMilestone, getProjectMilestones } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// A project's milestones (with the summary and what the person may do), and a new one.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context) => getProjectMilestones(client, context, id), "projects.milestones.view");
}
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => createProjectMilestone(client, context, id, input), 201, "projects.milestones.create");
}
