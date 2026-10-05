import { checkSalesOrderAvailability } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// Ordered, on hand, reserved elsewhere, available and shortage for each stock line, by warehouse.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.order.view", async (client, context) => ({ availability: await checkSalesOrderAvailability(client, context, id) }));
}
