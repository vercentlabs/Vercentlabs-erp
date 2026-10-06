import { getSalesOrderTracking } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// Where the order stands: its dimensions, lines, warnings, related documents and timeline, derived from the documents themselves.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.order.view", async (client, context) => ({ tracking: await getSalesOrderTracking(client, context, id) }));
}
