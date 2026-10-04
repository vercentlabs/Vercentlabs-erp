import { z } from "zod";

import { recordQuotationDecision } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// The customer's acceptance or rejection, recorded by staff. The operation checks the permission for the decision.
const schema = z.object({
  decision: z.enum(["accepted", "rejected"]),
  reference: z.string().max(200).optional(),
  notes: z.string().max(4000).optional(),
  customerName: z.string().max(200).optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.view", schema, async (client, context, input) => ({ result: await recordQuotationDecision(client, context, id, input) }));
}
