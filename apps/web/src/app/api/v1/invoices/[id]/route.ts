import { apiGetInvoice } from "@vercentlabs/api";

import { apiOne } from "@/core/api-records";

// GET /api/v1/invoices/{id} (scope invoices.read).
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiOne(request, "invoices.read", context.params, ({ client, principal }, id) => apiGetInvoice(client, principal, id));
}
