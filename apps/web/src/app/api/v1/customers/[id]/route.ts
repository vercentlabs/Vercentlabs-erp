import { apiGetCustomer } from "@vercentlabs/api";

import { apiOne } from "@/core/api-records";

// GET /api/v1/customers/{id} (scope customers.read).
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiOne(request, "customers.read", context.params, ({ client, principal }, id) => apiGetCustomer(client, principal, id));
}
