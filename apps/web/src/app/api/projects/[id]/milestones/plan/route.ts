import { applyProjectMilestonePlan } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// A planned set of milestones in order, each naming earlier ones (by position) as prerequisites.
type Params = { params: Promise<{ id: string }> };
const schema = z.object({ milestones: z.array(z.record(z.string(), z.unknown())).min(1).max(50), idempotencyKey: z.string().trim().min(1).max(200).optional() });
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => applyProjectMilestonePlan(client, context, id, input), 201, "projects.milestones.create");
}
