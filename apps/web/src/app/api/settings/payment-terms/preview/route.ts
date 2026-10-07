import { previewPaymentTerm } from "@vercentlabs/api";

import { previewSchema } from "@/features/settings/finance-commercial/payment-terms/server/schemas";
import { termsWrite } from "@/features/settings/finance-commercial/payment-terms/server/terms-http";

// The schedule a term (saved, or being edited) gives a document: the server's calculation, never the browser's.
export async function POST(request: Request) {
  return termsWrite(request, "payment_terms.view", previewSchema, async (client, context, input) => await previewPaymentTerm(client, context, input));
}
