import { setDefaultPurchasePaymentTerm, setDefaultSalesPaymentTerm } from "@vercentlabs/api";

import { defaultsSchema } from "@/features/settings/finance-commercial/payment-terms/server/schemas";
import { termsWrite } from "@/features/settings/finance-commercial/payment-terms/server/terms-http";

// Sets or clears a company default: { direction: "sales" | "purchase", termId: string | null }.
export async function POST(request: Request) {
  return termsWrite(request, "payment_terms.set_default", defaultsSchema, async (client, context, input) => ({
    result: input.direction === "sales" ? await setDefaultSalesPaymentTerm(client, context, input.termId) : await setDefaultPurchasePaymentTerm(client, context, input.termId),
  }));
}
