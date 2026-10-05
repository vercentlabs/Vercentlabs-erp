import { z } from "zod";

import { createQuotationRevision } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Creates the next revision (a new Draft quotation, QT-…-R1) of a confirmed or sent quotation.
const schema = z.object({ reason: z.string().max(1000), idempotencyKey: z.string().max(200).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.quotation.revise", schema, async (client, context, input) => ({ result: await createQuotationRevision(client, context, id, input) }));
}
