import { z } from "zod";

import { enterCount } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

// Enter what was counted on a line. body: { lineId, quantity (blank is not a count; 0 is none found), uomId?, notes?, source? }
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ detail: await enterCount(client, context, id, input) }), 200,
    STOCK_COUNT_PERMISSIONS.view);
}
