import { z } from "zod";

import { decideExtraMaterial } from "@vercentlabs/api";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// Approve or reject a request for extra material.
const schema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().max(1000).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string; varianceId: string }> }) {
  const { id, varianceId } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => ({ order: await decideExtraMaterial(client, context, id, varianceId, input) }));
}
