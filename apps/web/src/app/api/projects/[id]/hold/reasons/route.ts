import { addProjectHoldReason } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// Another reason the project stays on hold (a blocker with its own owner, impact and resolution).
type Params = { params: Promise<{ id: string }> };
const schema = z.object({
  reasonCode: z.string().max(40), description: z.string().max(2000), severity: z.string().max(20).optional(), ownerUserId: z.string().uuid().optional(),
  sourceType: z.enum(["TASK", "MILESTONE"]).optional(), sourceId: z.string().uuid().optional(), evidence: z.string().max(2000).optional(),
  expectedVersion: z.number().int().optional(), idempotencyKey: z.string().trim().min(1).max(200).optional(),
});
export async function POST(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => addProjectHoldReason(client, context, id, input));
}
