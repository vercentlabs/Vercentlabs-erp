import { z } from "zod";

import { decideOverproduction } from "@vercentlabs/api";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// Approve or reject a request for more good output than the plan (by someone other than the requester).
const schema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().max(1000).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => await decideOverproduction(client, context, id, requestId, input));
}
