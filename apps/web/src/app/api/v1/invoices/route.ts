import { apiListInvoices } from "@vercentlabs/api";

import { apiList } from "@/core/api-records";

// GET /api/v1/invoices (scope invoices.read): ?limit= (up to 200), ?offset=, ?search= and the list's filters.
export async function GET(request: Request) {
  return apiList(request, "invoices.read", ({ client, principal }, query) => apiListInvoices(client, principal, query));
}
