import { z } from "zod";

import { cancelDraftDebitNote } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", z.object({ reason: z.string().max(1000).optional() }), async (client, context, input) => ({ result: await cancelDraftDebitNote(client, context, id, input) }));
}
