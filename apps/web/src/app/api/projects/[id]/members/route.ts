import { addProjectMember, getProjectMembers } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };
// The team, current and past.
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context) => getProjectMembers(client, context, id));
}
const schema = z.object({ userId: z.string().uuid(), role: z.enum(["MEMBER", "VIEWER", "FINANCIAL_VIEWER"]) });
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => addProjectMember(client, context, id, input), 201);
}
