import { createSalesOrder, listSalesOrders } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";
import { documentSchema } from "@/features/sales/shared/schemas";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = {
    status: url.searchParams.get("status") || undefined,
    search: url.searchParams.get("search") || undefined,
    partyId: url.searchParams.get("partyId") || undefined,
    limit: url.searchParams.get("limit") || undefined,
    offset: url.searchParams.get("offset") || undefined,
  };
  return salesRead("sales.view", async (client, context) => ({ rows: await listSalesOrders(client, context, filters) }));
}

export async function POST(request: Request) {
  return salesMutation(request, "sales.order.create", documentSchema, async (client, context, input) => ({ order: await createSalesOrder(client, context, input) }), 201);
}
