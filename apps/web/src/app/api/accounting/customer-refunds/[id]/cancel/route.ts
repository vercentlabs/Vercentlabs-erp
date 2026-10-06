import { z } from "zod";

import { cancelDraftRefund } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

// Cancels a draft; nothing was paid. Its number is kept.
const schema = z.object({ reason: z.string().max(1000).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return accountingMutation(request, schema, async (client, context, input) => ({ result: await cancelDraftRefund(client, context, id, input) }), 200, "accounting.refund.cancel");
}
