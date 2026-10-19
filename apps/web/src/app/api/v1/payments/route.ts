import { apiListPayments } from "@vercentlabs/api";

import { apiList } from "@/core/api-records";

// GET /api/v1/payments (scope payments.read).
export async function GET(request: Request) {
  return apiList(request, "payments.read", ({ client, principal }, query) => apiListPayments(client, principal, query));
}
