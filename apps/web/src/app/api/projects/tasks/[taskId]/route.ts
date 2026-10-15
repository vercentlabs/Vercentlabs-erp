import { getTaskDetails, updateProjectTask } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// One task: everything on it, its readiness and what the person may do; and its edit.
type Params = { params: Promise<{ taskId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { taskId } = await ctx.params;
  return projectsRead(request, async (client, context) => getTaskDetails(client, context, taskId), "projects.tasks.view");
}
export async function PATCH(request: Request, ctx: Params) {
  const { taskId } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => updateProjectTask(client, context, taskId, input), 200, "projects.tasks.edit");
}
