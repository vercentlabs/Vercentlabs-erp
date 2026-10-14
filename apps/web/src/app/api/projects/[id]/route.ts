import { getProject, updateProject } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";
import { projectFields } from "@/features/projects/shared/schemas";

type Params = { params: Promise<{ id: string }> };
// One project: its details, team size, health and progress, hold, approval and what the person may do.
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ project: await getProject(client, context, id) }));
}
const schema = z.object({ ...projectFields, expectedVersion: z.number().int().optional() });
// Change the details (refused if someone changed it since it was loaded).
export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => updateProject(client, context, id, input));
}
