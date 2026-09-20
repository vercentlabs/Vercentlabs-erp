import { z } from "zod";

import { submitQuotation } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

const schema = z.object({ assignedTo: z.string().uuid().nullish() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.quotation.create", schema, async (client, context, input) => ({ result: await submitQuotation(client, context, id, input.assignedTo ?? null) }));
}
