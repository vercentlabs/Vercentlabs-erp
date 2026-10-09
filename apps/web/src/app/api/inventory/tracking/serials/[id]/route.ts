import { getSerialDetail } from "@vercentlabs/api";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// One serial number, identity first: where it is now, its source receipt, reservation, quality holds and its whole journey.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryRead(request, async (client, context) => ({ detail: await getSerialDetail(client, context, id) }));
}
