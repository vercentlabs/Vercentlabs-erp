import { getSalesOrderSupply } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// What the order's "buy" and "make" lines raised on confirmation (Sales report Phase 3).
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.order.view", async (client, context) => ({ supply: await getSalesOrderSupply(client, context, id) }));
}
