import { getSalesOrderReservations } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// The order's reservations: reserved, still held, consumed by which delivery, released and why, and for how long.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesRead(request, "sales.reservation.view", async (client, context) => ({ reservations: await getSalesOrderReservations(client, context, id) }));
}
