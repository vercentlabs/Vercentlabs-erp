import { z } from "zod";

import { sendQuotation } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({ expiresInDays: z.number().int().min(1).max(365).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.quotation.send", schema, async (client, context, input) => ({ result: await sendQuotation(client, context, id, input.expiresInDays ?? 30) }));
}
