import { z } from "zod";

import { cancelDraftReturn } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Cancels a draft; nothing moved.
const schema = z.object({ reason: z.string().max(1000).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.return.edit", schema, async (client, context, input) => ({ result: await cancelDraftReturn(client, context, id, input) }));
}
