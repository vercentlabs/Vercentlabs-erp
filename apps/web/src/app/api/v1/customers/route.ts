import { apiCreateCustomer, apiListCustomers } from "@vercentlabs/api";

import { apiList, apiCreate } from "@/core/api-records";

// GET /api/v1/customers (scope customers.read): ?limit= (up to 200), ?offset=, ?search= and the list's filters.
export async function GET(request: Request) {
  return apiList(request, "customers.read", ({ client, principal }, query) => apiListCustomers(client, principal, query));
}

// POST /api/v1/customers (scope customers.write): the record as JSON, checked exactly as on screen.
export async function POST(request: Request) {
  return apiCreate(request, "customers.write", ({ client, principal }, input) => apiCreateCustomer(client, principal, input));
}
