import { z } from "zod";

import { markRefundConfirmationSent } from "@vercentlabs/api";

import { accountingMutation } from "@/features/accounting/shared/route-helpers";

// Records that the refund confirmation went to the customer another way.
const schema = z.object({ channel: z.string().max(40), recipient: z.string().max(320).optional(), note: z.string().max(1000).optional(), idempotencyKey: z.string().max(200).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return accountingMutation(request, schema, async (client, context, input) => ({ result: await markRefundConfirmationSent(client, context, id, input) }), 200, "accounting.refund.send");
}
