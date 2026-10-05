import { z } from "zod";

import { markSalesInvoiceSent } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Records that the invoice went to the customer another way.
const schema = z.object({ channel: z.string().max(40), recipient: z.string().max(320).optional(), note: z.string().max(1000).optional(), sentAt: z.string().optional(), idempotencyKey: z.string().max(200).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.invoice.send", schema, async (client, context, input) => ({ result: await markSalesInvoiceSent(client, context, id, input) }));
}
