import { getSalesOrderDefaults } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// What a new order starts with, for the chosen customer (and why it cannot be placed, when it cannot).
export async function GET(request: Request) {
  const partyId = new URL(request.url).searchParams.get("partyId");
  return salesRead(request, "sales.order.create", async (client, context) => ({ defaults: await getSalesOrderDefaults(client, context, { partyId }) }));
}
