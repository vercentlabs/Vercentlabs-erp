import { getSalesManufacturingProgress } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// Production status of the order's manufactured lines, for anyone who may see the order (no cost).
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.order.view", async (client, context) => ({ progress: await getSalesManufacturingProgress(client, context, id) }));
}
