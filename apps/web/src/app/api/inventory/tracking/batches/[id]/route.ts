import { getBatchDetail } from "@vercentlabs/api";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// One batch wherever it is: stock by position and disposition, expiry, reservations, quality holds and its movement trail.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryRead(request, async (client, context) => ({ detail: await getBatchDetail(client, context, id) }));
}
