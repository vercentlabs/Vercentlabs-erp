import { createPaymentTerm, listPaymentTerms } from "@vercentlabs/api";

import { termSchema } from "@/features/settings/finance-commercial/payment-terms/server/schemas";
import { termsRead, termsWrite } from "@/features/settings/finance-commercial/payment-terms/server/terms-http";

// Settings → Payment Terms: every term (filtered), the choices the editor offers and the company registrations a term can be scoped to.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["status", "search", "usage", "termType", "buyingRegistrationId"].flatMap((key) => {
    const value = url.searchParams.get(key);
    return value ? [[key, value]] : [];
  }));
  return termsRead(request, "payment_terms.view", async (client, context) => await listPaymentTerms(client, context, filters));
}

export async function POST(request: Request) {
  return termsWrite(request, "payment_terms.manage", termSchema, async (client, context, input) => ({ term: await createPaymentTerm(client, context, input) }), 201);
}
