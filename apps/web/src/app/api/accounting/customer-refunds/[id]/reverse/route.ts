import { z } from "zod";

import { reverseCustomerRefund } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

// Reverses a posted refund entered in error: the money movement is reversed and the credit restored.
const schema = z.object({ reason: z.string().trim().min(1).max(1000) });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return accountingMutation(request, schema, async (client, context, input) => ({ result: await reverseCustomerRefund(client, context, id, input) }), 200, "accounting.refund.reverse");
}
