import { getTaskProgressHistory } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// The project's task progress at the end of each past week, rebuilt from the tasks' status history (?weeks=12).
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context, url) => ({ points: await getTaskProgressHistory(client, context, id, { weeks: Number(url.searchParams.get("weeks")) || 12 }) }), "projects.tasks.view");
}
