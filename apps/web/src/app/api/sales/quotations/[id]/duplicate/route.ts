import { z } from "zod";

import { duplicateQuotation } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// A new, independent Draft with the same customer and lines, priced from today's lists.
const schema = z.object({ idempotencyKey: z.string().max(200).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.quotation.create", schema, async (client, context, input) => ({ result: await duplicateQuotation(client, context, id, input) }));
}
