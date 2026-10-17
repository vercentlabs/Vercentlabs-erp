import { setTaskBillingRule } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation } from "@/features/projects/shared/route-helpers";

// A task held non-billable, or tied to one contract line; an empty rule follows the project's policy again.
type Params = { params: Promise<{ taskId: string }> };
const schema = z.object({ rule: z.enum(["NON_BILLABLE", "CONTRACT_LINE"]).nullable().optional(), contractLineId: z.string().uuid().optional(), reasonCode: z.string().max(40).optional(),
  note: z.string().max(500).optional() });
export async function POST(request: Request, ctx: Params) {
  const { taskId } = await ctx.params;
  return projectsMutation(request, schema, async (client, context, input) => setTaskBillingRule(client, context, taskId, input));
}
