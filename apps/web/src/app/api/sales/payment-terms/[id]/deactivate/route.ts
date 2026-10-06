import { deactivatePaymentTerm } from "@vercentlabs/api";

import { emptySchema } from "@/features/sales/shared/schemas";
import { salesMutation } from "@/features/sales/shared/route-helpers";

// No longer offered on new documents; it stays on the customers and documents that have it.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "payment_terms.manage", emptySchema, async (client, context) => ({ term: await deactivatePaymentTerm(client, context, id) }));
}
