import { resolveProjectHoldReason } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// One hold reason cleared, with how (and, for a customer approval, the evidence). The project does not resume by itself.
type Params = { params: Promise<{ id: string; reasonId: string }> };
const schema = z.object({ resolution: z.string().max(2000), evidence: z.string().max(2000).optional(), expectedVersion: z.number().int().optional() });
export async function POST(request: Request, ctx: Params) {
  const { id, reasonId } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => resolveProjectHoldReason(client, context, id, reasonId, input));
}
