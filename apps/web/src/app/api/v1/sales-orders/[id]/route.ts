import { apiGetSalesOrder } from "@vercentlabs/api";

import { apiOne } from "@/core/api-records";

// GET /api/v1/sales-orders/{id} (scope sales_orders.read).
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiOne(request, "sales_orders.read", context.params, ({ client, principal }, id) => apiGetSalesOrder(client, principal, id));
}
