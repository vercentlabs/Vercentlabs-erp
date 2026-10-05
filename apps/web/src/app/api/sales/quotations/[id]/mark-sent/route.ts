import { z } from "zod";

import { markQuotationSent } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// The quotation went out another way (in person, WhatsApp, the customer's own email).
const schema = z.object({ recipient: z.string().max(320).optional(), note: z.string().max(1000).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.quotation.send", schema, async (client, context, input) => ({ result: await markQuotationSent(client, context, id, input) }));
}
