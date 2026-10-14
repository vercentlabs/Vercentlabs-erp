import { addProjectNote, getProjectNotes } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context) => getProjectNotes(client, context, id));
}
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsMutation(request, z.object({ body: z.string().min(1).max(5000), customerContactId: z.string().uuid().optional() }), async (client, context, input) => addProjectNote(client, context, id, input), 201);
}
