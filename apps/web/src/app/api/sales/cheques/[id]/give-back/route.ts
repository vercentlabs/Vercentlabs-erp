import { z } from "zod";

import { cancelPostDatedCheque } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// A post-dated cheque given back to the customer before it was deposited.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", z.object({ reason: z.string().trim().max(500).optional() }), async (client, context, input) => ({
    result: await cancelPostDatedCheque(client, context, id, input),
  }));
}
