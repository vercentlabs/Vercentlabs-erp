import { addProjectSite, listProjectSites } from "@vercentlabs/api";
import { z } from "zod";

import { siteFields } from "@/features/projects/shared/schemas";
import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };
// Where the project is delivered (?removed=1 includes removed sites).
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context, url) => listProjectSites(client, context, id, { includeRemoved: url.searchParams.get("removed") === "1" }));
}
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsMutation(request, z.object({ ...siteFields, siteName: z.string().min(1).max(120) }), async (client, context, input) => addProjectSite(client, context, id, input), 201);
}
