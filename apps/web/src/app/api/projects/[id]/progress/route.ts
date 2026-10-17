import { getProjectProgressSummary } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// One project's progress: task completion, required milestones, schedule, health and its reasons, effort against estimate, scope against
// its baseline, by assignee, the latest changes and whether the recorded history is in step with the records.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ progress: await getProjectProgressSummary(client, context, id) }));
}
