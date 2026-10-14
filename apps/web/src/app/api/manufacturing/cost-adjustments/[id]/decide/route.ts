import { decideCostAdjustment } from "@vercentlabs/api";
import { z } from "zod";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// Approve (posted once) or reject a requested production cost adjustment — by someone other than the requester.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().max(1000).optional() }),
    async (client, context, input) => decideCostAdjustment(client, context, id, input));
}
