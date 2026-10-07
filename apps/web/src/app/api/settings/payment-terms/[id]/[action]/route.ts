import { activatePaymentTerm, deactivatePaymentTerm, setDefaultPurchasePaymentTerm, setDefaultSalesPaymentTerm } from "@vercentlabs/api";

import { errorResponse, HttpError } from "@/core/http";
import { emptySchema } from "@/features/settings/finance-commercial/payment-terms/server/schemas";
import { termsWrite } from "@/features/settings/finance-commercial/payment-terms/server/terms-http";

type Params = { params: Promise<{ id: string; action: string }> };

// A term's commands: activate, deactivate, and make it the company default for Sales or for Purchases.
export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  if (action === "activate") return termsWrite(request, "payment_terms.manage", emptySchema, async (client, context) => ({ term: await activatePaymentTerm(client, context, id) }));
  if (action === "deactivate") return termsWrite(request, "payment_terms.manage", emptySchema, async (client, context) => ({ term: await deactivatePaymentTerm(client, context, id) }));
  if (action === "default-sales")
    return termsWrite(request, "payment_terms.set_default", emptySchema, async (client, context) => ({ result: await setDefaultSalesPaymentTerm(client, context, id) }));
  if (action === "default-purchase")
    return termsWrite(request, "payment_terms.set_default", emptySchema, async (client, context) => ({ result: await setDefaultPurchasePaymentTerm(client, context, id) }));
  return errorResponse(new HttpError(404, "Unknown action."));
}
