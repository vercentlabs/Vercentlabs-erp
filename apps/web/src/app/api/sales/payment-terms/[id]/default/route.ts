import { setDefaultSalesPaymentTerm } from "@vercentlabs/api";

import { emptySchema } from "@/features/sales/shared/schemas";
import { salesMutation } from "@/features/sales/shared/route-helpers";

// The one term new sales documents use when the customer has none.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "payment_terms.set_default", emptySchema, async (client, context) => ({ result: await setDefaultSalesPaymentTerm(client, context, id) }));
}
