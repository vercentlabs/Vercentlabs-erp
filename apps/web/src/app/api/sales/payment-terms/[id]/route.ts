import { z } from "zod";

import { getPaymentTerm, updatePaymentTerm } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesRead(request, "payment_terms.view", async (client, context) => await getPaymentTerm(client, context, id));
}

// The name, description and where it is offered; how the due date is worked out only while nothing uses the term.
const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  calculationType: z.enum(["due_on_receipt", "net_days", "custom"]).optional(),
  days: z.union([z.number(), z.string()]).nullable().optional(),
  description: z.string().max(1000).nullable().optional(),
  salesEnabled: z.boolean().optional(),
  purchaseEnabled: z.boolean().optional(),
});

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return salesMutation(request, "payment_terms.manage", schema, async (client, context, input) => ({ term: await updatePaymentTerm(client, context, id, input) }));
}
