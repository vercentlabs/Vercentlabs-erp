import { getPaymentTerm, updatePaymentTerm } from "@vercentlabs/api";

import { termSchema } from "@/features/settings/finance-commercial/payment-terms/server/schemas";
import { termsRead, termsWrite } from "@/features/settings/finance-commercial/payment-terms/server/terms-http";

type Params = { params: Promise<{ id: string }> };

// One term with its history and versions (GET); its edits — the rules in place while nothing uses it, else as a new version (PATCH).
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return termsRead(request, "payment_terms.view", async (client, context) => await getPaymentTerm(client, context, id));
}

export async function PATCH(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return termsWrite(request, "payment_terms.manage", termSchema, async (client, context, input) => ({ term: await updatePaymentTerm(client, context, id, input) }));
}
