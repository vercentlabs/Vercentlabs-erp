import { getProjectTimeBillingSummary } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// Recorded, billable, approved, reserved, invoiced and free-to-request time of a project — separate measures.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ summary: await getProjectTimeBillingSummary(client, context, id) }));
}
