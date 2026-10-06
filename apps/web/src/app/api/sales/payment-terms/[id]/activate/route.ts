import { activatePaymentTerm } from "@vercentlabs/api";

import { emptySchema } from "@/features/sales/shared/schemas";
import { salesMutation } from "@/features/sales/shared/route-helpers";

// Active again: it can be chosen on new documents.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "payment_terms.manage", emptySchema, async (client, context) => ({ term: await activatePaymentTerm(client, context, id) }));
}
