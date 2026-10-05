import { createSalesOrder, listSalesOrders } from "@vercentlabs/api";

import { orderFiltersFromUrl } from "@/features/sales/orders/server/order-http";
import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";
import { documentSchema } from "@/features/sales/shared/schemas";

// The sales order list: view, search, filters, sort and paging; scoped to the
// orders the caller may see (own / team / all).
export async function GET(request: Request) {
  const filters = orderFiltersFromUrl(new URL(request.url));
  return salesRead(request, "sales.order.view", async (client, context) => await listSalesOrders(client, context, filters));
}

// A new Draft order (Sales → Sales Orders → New). From an accepted quotation, use the quotation's route.
export async function POST(request: Request) {
  return salesMutation(request, "sales.order.create", documentSchema, async (client, context, input) => ({ order: await createSalesOrder(client, context, input) }), 201);
}
