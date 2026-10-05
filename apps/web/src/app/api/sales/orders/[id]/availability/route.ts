import { checkSalesOrderAvailability } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// The order's stock availability now, line by line and per warehouse, with its time.
// Reads only: nothing is reserved, locked or recorded on the order.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.availability.check", async (client, context) => ({ availability: await checkSalesOrderAvailability(client, context, id) }));
}
