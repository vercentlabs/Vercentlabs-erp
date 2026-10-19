import { apiCreateSalesOrder, apiListSalesOrders } from "@vercentlabs/api";

import { apiList, apiCreate } from "@/core/api-records";

// GET /api/v1/sales-orders (scope sales_orders.read): ?limit= (up to 200), ?offset=, ?search= and the list's filters.
export async function GET(request: Request) {
  return apiList(request, "sales_orders.read", ({ client, principal }, query) => apiListSalesOrders(client, principal, query));
}

// POST /api/v1/sales-orders (scope sales_orders.write): the record as JSON, checked exactly as on screen.
export async function POST(request: Request) {
  return apiCreate(request, "sales_orders.write", ({ client, principal }, input) => apiCreateSalesOrder(client, principal, input));
}
