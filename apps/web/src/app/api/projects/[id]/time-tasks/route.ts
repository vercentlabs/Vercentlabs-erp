import { getProjectTimeTasks } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// The tasks time can be recorded on (?search=), and — for a project one leads — its team.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context, url) => getProjectTimeTasks(client, context, id, { search: url.searchParams.get("search") ?? undefined }));
}
