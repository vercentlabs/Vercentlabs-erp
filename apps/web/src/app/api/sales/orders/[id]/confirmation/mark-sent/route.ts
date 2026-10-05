import { z } from "zod";

import { markOrderConfirmationSent } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// The confirmation went out another way: another mailbox, WhatsApp, on paper.
const schema = z.object({
  channel: z.string().max(40),
  recipient: z.string().max(320).optional(),
  note: z.string().max(1000).optional(),
  sentAt: z.string().max(40).optional(),
  idempotencyKey: z.string().max(200).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.confirmation.mark_sent", schema, async (client, context, input) => ({ result: await markOrderConfirmationSent(client, context, id, input) }));
}
